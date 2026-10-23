/**
 * Script-to-Video — sequential AI clip pipeline (Sep 2026 rebuild).
 *
 *   Script → creative planner reads the WHOLE story → intent-led scene plan
 *          → shared routing resolves an engine and legal duration per shot
 *          → one prompt at a time (global + scene + continuity context)
 *          → auto-generate when ready, or an explicit click
 *          → FFmpeg extracts + validates each clip's real final frame
 *          → every later scene waits for and starts from the validated prior frame
 *          → FFmpeg assembles the final film
 *
 * Prompt preparation and generation are SEPARATE operations; dependent clips
 * are never generated simultaneously; a failed scene never loses completed
 * ones. State persists to WorkspaceDB after every step — reopening a film
 * resumes in-flight renders. Screens: Library · Create · Board · Final · Legacy.
 */
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Download } from 'lucide-react';
import { Film, FilmCharacter, FilmScene, StoredReference, T, db, generateBackdropImage, newSceneKey, referenceSlug } from './api';
import {
  AssemblyProgress, allScenesDone, assembleReadyFilm,
  autoPostProduce, autoProduce, changeMusicDirection, changeNarrationVoice,
  changeVoiceSource, continueWithoutContinuityFrame, createAndSegmentFilm, createManualScriptFilm,
  generateAllReadyScenes, generateScene, prepareFilmAudioStage, prepareScene,
  readyToAutoAssemble, regenerateNarration, regenerateScenePrompt, retryFinalFrame,
  regenerateSfx, retryAudioLayer, retryScene, runAudioLayerStep,
  runFinalAssembly, setStyleLock, skipAudioLayer, skipScene, stopFinalAssembly,
} from './pipeline/orchestrator';
import { audioReady, generateCharacterDialogueFallback } from './pipeline/audio';
import { SEEDANCE_2_5, VideoModelService, resolveVideoModel } from './pipeline/videoModelService';
import { askOpusJson, characterPortraitBrief } from './pipeline/opus';
import {
  DEFAULT_OPENAI_VOICE, elevenLabsOffered, loadOpenAiVoicePref, loadVoiceSourcePref,
  saveOpenAiVoicePref, saveVoiceSourcePref, subscribeElevenLabs,
  syncElevenLabsAvailability,
} from './pipeline/voiceSource';
import type { VoiceSourceId } from './pipeline/voiceSource';
import { LB_SHIMMER_CSS } from '../../components/LightBeam';
import ProductSuiteHeader from '../../components/ProductSuiteHeader';
import Library, { LegacyFilm } from './Library';
import type { CreateMode } from './CreateFlow';
import { audioPolicyFlags } from './v2Contracts';
import type { AudioPolicy, ControlMode, ExecutionMode, VideoStyleId } from './v2Contracts';
import type { AgentMessage, AgentMetrics, AgentProposal, AgentUndo } from './assistantRuntime';

const CreateScreen = lazy(() => import('./CreateFlow').then((module) => ({ default: module.CreateScreen })));
const RenderRoom = lazy(() => import('./RenderRoom'));
const FinalScreen = lazy(() => import('./ReviewFinish').then((module) => ({ default: module.FinalScreen })));
const AgentPanel = lazy(() => import('./AgentPanel'));
const AssemblyBar = lazy(() => import('./AssemblyBar')); 
import { videoEngine } from '../../lib/videoEngines';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import type { ScriptToVideoHandoff, VidvergeAttachment } from '../../lib/vidvergeHandoff';
import { saveVideoSelection } from '../../lib/videoIntegrations';
import { callHook } from '../../lib/workspace';
import { authorizeCredits, refundCreditsStrict } from '../../lib/credits';
import AppShell from '../../components/ui/AppShell';
import { withBrandContext } from '../../components/BrandContextLayer';
import ProbedVideo from './ClipAudioStatus';
import type { ClipAudioProbe } from './pipeline/capture';

type Screen = 'library' | 'create' | 'board' | 'final' | 'legacy';

function friendlyAppError(value: unknown): string {
  const raw = String(value || 'This step could not be completed.');
  const named = raw.replace(/(?:openrouter\/[^\s,;]+|gemini-omni-flash-preview|veo-[\w.-]+)/g, (id) => videoEngine(id)?.label || 'the selected video engine');
  const publicMessage = named.split(' Technical details:')[0].trim();
  // "Workspace session required" is a SIGN-IN problem, not a credits problem —
  // it is the session-gated generation hook refusing a call that carried no
  // validated session id. It must be matched before the credits branch: the
  // old /required/ keyword there used to relabel it as a wallet error.
  // Classify only the customer-facing sentence. Technical details can contain
  // a generic code such as provider_error even for a precise HTTP 400; matching
  // that suffix used to mislabel invalid settings as a provider outage.
  if (/operation was aborted|aborterror|signal is aborted|generation was interrupted/i.test(publicMessage)) return 'The image request ended before a result was confirmed. Your plan is safe. Use “Retry fast image,” upload your own sheet, reuse an existing one, or remove that cast member.';
  if (/session required|workspace session/i.test(publicMessage)) return 'Your sign-in session could not be verified, so the render was refused before anything was charged. Refresh the page, sign in again, then retry.';
  if (/cast_approval_required|approve every retained character/i.test(publicMessage)) return 'Approve every retained character sheet, or confirm that no cast is needed, before Start.';
  if (/workspace_service_credential_unavailable|workspace-level service credential|closed-tab generation cannot authenticate/i.test(publicMessage)) return 'This model is not available for durable server-side production yet. Choose Gemini Omni; no paid render was started.';
  if (/billing_http_(?:401|403)|no_credentials|\b401\b|\b403\b/i.test(publicMessage)) return 'Sign-in session expired — refresh and retry. No render was submitted.';
  if (/workspace wallet|wallet balance is too low|provider wallet/i.test(publicMessage)) return 'Video generation is paused because the studio provider wallet needs funding. Your film is saved and the failed scene authorization was refunded.';
  if (/\binsufficient_credits\b/i.test(publicMessage)) return 'You do not have enough Vidverge credits for this scene. Add credits, then retry.';
  if (/billing[_-]/i.test(publicMessage)) return 'Credit authorization could not be confirmed. Refresh your signed-in session and retry; no render was submitted.';
  if (/rate.?limit|\b429\b/i.test(publicMessage)) return 'The video service is busy right now. Wait a moment, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(publicMessage)) return 'The video service is temporarily unavailable. Your film is saved; retry this step shortly.';
  return publicMessage;
}

function requiresSignedInVideoTab(_film: Film, _scenes: FilmScene[]): boolean {
  // Long-running provider work is never allowed to fall back to this tab.
  // The durable server runner either accepts the selected model or returns a
  // clear pre-submit error so no paid render is stranded when the page closes.
  return false;
}

async function settlePendingBackgroundRefunds(film: Film): Promise<void> {
  const background = film.plan?.background as any;
  const pending = Array.isArray(background?.pending_refunds) ? background.pending_refunds : [];
  if (!film.plan || !pending.length) return;
  const settled: string[] = [];
  for (const item of pending) {
    const key = String(item?.entryKey || '').trim();
    if (!key) continue;
    await refundCreditsStrict(key, String(item?.reason || 'The background provider failed'));
    settled.push(key);
  }
  if (!settled.length) return;
  const plan = {
    ...film.plan,
    background: {
      ...background,
      pending_refunds: pending.filter((item: any) => !settled.includes(String(item?.entryKey || ''))),
      refunds_reconciled_at: new Date().toISOString(),
    },
  };
  await db.updateFilm(film.id, { plan });
  film.plan = plan;
}

async function preauthorizeBackgroundScenes(film: Film, scenes: FilmScene[]): Promise<string[]> {
  const newlyCharged: string[] = [];
  try {
    for (const scene of scenes) {
      if (scene.status === 'completed' || scene.status === 'skipped') continue;
      const key = `stv:film:${film.id}:scene:${scene.id}:${scene.scene_key || ''}`;
      const charge = await authorizeCredits({
        seconds: Math.max(1, Math.ceil(Number(scene.duration_s) || 0)),
        entryKey: key,
        source: 'script-to-video',
        note: `${resolveVideoModel((scene.spec as any)?.engine_id || film.video_model).label} durable scene authorization`,
      });
      if (charge.charged > 0) newlyCharged.push(key);
    }
    return newlyCharged;
  } catch (error: any) {
    await Promise.all(newlyCharged.map((key) => refundCreditsStrict(key, 'Script-to-Video Start authorization rolled back before any render submit')));
    if (error?.code === 'insufficient_credits') throw new Error(`insufficient_credits: ${String(error?.message || error)}`);
    throw error;
  }
}

/** Auto-generate is remembered per film. The pipeline prepares one prompt at a
 * time, so a film reopened halfway through has to resume on its own instead of
 * waiting at PROMPT_READY for a click the toggle says is not needed. Films
 * that predate the preference default to on — that is what the board already
 * did for every freshly planned film. */
const autoPrefKey = (filmId: number) => `s2v:auto-generate:${filmId}`;

function readAutoPref(filmId: number): boolean {
  try {
    const stored = window.localStorage.getItem(autoPrefKey(filmId));
    return stored === '1';
  } catch { return false; }
}

function writeAutoPref(filmId: number, on: boolean) {
  try { window.localStorage.setItem(autoPrefKey(filmId), on ? '1' : '0'); } catch { /* preference only */ }
}

const APP_CSS = `
  .s2v-app button { min-height: 44px; transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; }
  .s2v-app button:focus-visible, .s2v-app a:focus-visible, .s2v-app input:focus-visible, .s2v-app textarea:focus-visible, .s2v-app select:focus-visible { outline: 2px solid var(--vg-focus); outline-offset: 3px; box-shadow: none; }
  ${LB_SHIMMER_CSS}
  .s2v-app input, .s2v-app textarea, .s2v-app select { transition: border-color 0.18s ease, box-shadow 0.18s ease; }
  .s2v-app input[type="checkbox"], .s2v-app input[type="radio"], .s2v-app input[type="range"] { accent-color: var(--vg-accent); }
  .s2v-row { transition: background-color 0.16s ease; border-radius: 10px; }
  .s2v-row:hover { background: color-mix(in srgb, ${T.live} 7%, transparent) !important; }
  .s2v-lift:hover:not(:disabled) { transform: translateY(-1px); }
  .s2v-lift:active:not(:disabled) { transform: translateY(0); }
  .s2v-ghost:hover:not(:disabled) { color: ${T.bone} !important; background: color-mix(in srgb, ${T.live} 10%, transparent) !important; }
  .s2v-app ::-webkit-scrollbar { width: 6px; height: 6px; }
  .s2v-app ::-webkit-scrollbar-thumb { background: color-mix(in srgb, ${T.live} 36%, transparent); border-radius: 999px; }
  .s2v-app ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, ${T.live} 58%, transparent); }
  .s2v-app ::-webkit-scrollbar-track { background: ${T.canvas}; }
  .s2v-create-inner { padding-bottom: 32px; }
  .s2v-create-section { margin-bottom: 24px; }
  .s2v-create-actions { position: sticky; z-index: 8; bottom: 72px; display: flex; justify-content: flex-end; margin-top: 28px; padding: 14px 0 18px; background: linear-gradient(180deg, transparent, color-mix(in srgb, ${T.canvas} 96%, transparent) 28%); }
  .s2v-create-primary { width: min(100%, 320px); justify-content: center; }
  .s2v-screen-skeleton { flex: 1; display: grid; place-items: center; min-height: 260px; padding: 28px; color: ${T.muted}; }
  .s2v-screen-skeleton > span { width: min(100%, 720px); height: 180px; border-radius: 16px; border: 1px solid ${T.dim}; background: linear-gradient(110deg, ${T.raised} 20%, color-mix(in srgb, ${T.live} 10%, ${T.raised}) 38%, ${T.raised} 56%); background-size: 220% 100%; animation: lb-shimmer 1.4s linear infinite; }
  @media (max-width: 767px) {
    .s2v-create-scroll { padding: 20px 16px 148px !important; }
    .s2v-create-inner { max-width: 100% !important; }
    .s2v-create-actions { bottom: 84px; padding-top: 18px; }
    .s2v-create-primary { width: 100%; }
    .s2v-stage-grid { margin-left: -2px; margin-right: -2px; scroll-snap-type: x proximity; }
    .s2v-stage-grid > * { scroll-snap-align: start; }
    .s2v-board { flex-direction: column !important; overflow-y: auto; }
    .s2v-scene-rail { width: 100% !important; min-height: 220px !important; max-height: 290px; border-right: 0 !important; border-bottom: 1px solid var(--vg-border); }
    .s2v-board-panel { overflow: visible !important; padding: 16px 16px 112px !important; }
    .s2v-cast-grid { grid-template-columns: minmax(0, 1fr) !important; }
    .s2v-app textarea { font-size: 16px !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .s2v-app *, .s2v-app *::before, .s2v-app *::after { transition-duration: 0.01ms !important; }
    .s2v-app .animate-spin, .s2v-app .lb-shimmer { animation: none !important; }
  }
`;

/** The studio canvas. A flat fill read cheap next to the rest of the suite, so
 * the shell sits on a subtle amber wash over the dark-cosmic ground instead. */
const CANVAS_GRADIENT = 'radial-gradient(ellipse 72% 48% at 50% -10%, color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent), transparent 64%), linear-gradient(160deg, var(--space-surface-bg), var(--space-surface-card))';

/** The premium champagne-gold CTA, derived from the shared brand tokens. */
const CTA_GRADIENT = 'var(--vg-gradient-action)';

/** Text that sits on CTA_GRADIENT and on the solid accent. */
const ON_ACCENT = 'var(--vg-on-accent, #1B1308)';

function ScriptToVideoApp() {
  const [screen, setScreen] = useState<Screen>('library');
  const [films, setFilms] = useState<Film[]>([]);
  const [legacy, setLegacy] = useState<LegacyFilm[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [quickText, setQuickText] = useState('');
  const [handoffAttachment, setHandoffAttachment] = useState<VidvergeAttachment | null>(null);
  const [handoffIntake, setHandoffIntake] = useState<ScriptToVideoHandoff | null>(null);
  const [film, setFilm] = useState<Film | null>(null);
  const [scenes, setScenes] = useState<FilmScene[]>([]);
  const [auto, setAuto] = useState(false);
  const [autoPost, setAutoPost] = useState(true);
  const [captions, setCaptions] = useState(false);
  // VOICE SOURCE — narration is optional, and the choice is remembered for the
  // whole browser session so it is picked once rather than per film. With no
  // pick yet it is NO voiceover: the one setting that cannot wait on a voice
  // provider, which is what stops this step stalling a film. Opening a film
  // that already has an audio plan shows that film's own source instead
  // (see adopt() below and resolveVoiceSource in pipeline/audio.ts).
  const [voiceSource, setVoiceSource] = useState<VoiceSourceId>(() => loadVoiceSourcePref() || 'none');
  const [openaiVoice, setOpenaiVoice] = useState<string>(() => loadOpenAiVoicePref() || DEFAULT_OPENAI_VOICE);
  const [elevenOffered, setElevenOffered] = useState<boolean>(() => elevenLabsOffered());
  const [assembly, setAssembly] = useState<AssemblyProgress | null>(null);
  const [legacyOpen, setLegacyOpen] = useState<LegacyFilm | null>(null);
  // The completed scene currently being redone (fresh prompt + re-render), so
  // the board can show live progress from the first click.
  const [redoingId, setRedoingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialogueAudioSceneId, setDialogueAudioSceneId] = useState<number | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [adminDiagnoses, setAdminDiagnoses] = useState<any[]>([]);

  // The orchestrator works on MUTABLE engine objects (the state machine folds
  // continuity from clip to clip); React state mirrors them through the hooks.
  const engineFilm = useRef<Film | null>(null);
  const engineScenes = useRef<FilmScene[]>([]);
  const running = useRef(false);
  const planQueue = useRef<Promise<void>>(Promise.resolve());
  const autoRef = useRef(false);
  const autoPostRef = useRef(true);
  // One-shot guards per film: the auto-advance to post-production and the
  // audio auto-run each fire once per opened film — never in a loop.
  const advancedFor = useRef<number | null>(null);
  const postKickedFor = useRef<number | null>(null);
  // Final Assembly fires at most once per film without a click. A re-run is
  // always available from the assembly bar.
  const assembleKickedFor = useRef<number | null>(null);
  const reviewRef = useRef(false);
  const captionsRef = useRef(false);
  captionsRef.current = captions;
  // One retry per stalled scene, ever — the watchdog is a rescue, not a loop.
  const stallRetriedScenes = useRef<Set<number>>(new Set());
  // Auto-generate fires once per PROMPT_READY scene: the key is film + scene,
  // so every newly prepared clip re-arms the trigger while a scene already
  // handed to the engine never fires twice.
  const autoFiredFor = useRef('');
  // One-shot guard for the stalled frame-extraction recovery, per film.
  const frameRecoveryFor = useRef<number | null>(null);
  // When the film entered its current machine_state, so a stall is measured
  // from the transition rather than from when this tab happened to open it.
  const stateSince = useRef<{ id: number; state: string; at: number }>({ id: 0, state: '', at: 0 });
  // Masters already recorded in the suite-wide history, so reopening a
  // finished film does not record it again.
  const recordedVideoUrls = useRef<Set<string>>(new Set());

  const hooks = useRef({
    onFilm: (patch: Partial<Film>) => setFilm((f) => (f ? { ...f, ...patch } : f)),
    onScene: (id: number, patch: Partial<FilmScene>) => setScenes((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    onNote: (n: string) => setNote(n),
    onAssembly: (p: AssemblyProgress) => setAssembly(p),
  }).current;

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    // Current and retired projects are independent reads. Start both together,
    // but only current films gate the first usable library paint.
    const legacyPromise = (async () => {
      const wdb = (window as any).__workspaceDb;
      if (!wdb) return [] as LegacyFilm[];
      const { data } = await wdb.from('s2v_projects').orderBy('created_at', 'desc').limit(50).get();
      return (Array.isArray(data) ? data : [])
        .filter((r: any) => r && (r.final_url || r.assembled_url))
        .map((r: any) => ({ id: Number(r.id), title: String(r.title || 'Legacy video'), final_url: String(r.final_url || r.assembled_url || ''), created_at: String(r.created_at || '') }));
    })();
    void legacyPromise.then(setLegacy).catch(() => setLegacy([]));
    try {
      setFilms(await db.listFilms());
      setError('');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLibLoading(false);
    }
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);
  // Warm only the next likely screen after the library paints. This keeps the
  // large planning UI out of the critical bundle without making New Film wait
  // on a cold download.
  useEffect(() => {
    const warm = () => { void import('./CreateFlow'); };
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(warm, { timeout: 1800 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 450);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!jobsOpen) return;
    void callHook<{ diagnoses?: any[] }>('s2v-admin-diagnoses', { limit: 30 })
      .then((result) => setAdminDiagnoses(Array.isArray(result?.diagnoses) ? result.diagnoses : []))
      .catch(() => setAdminDiagnoses([]));
  }, [jobsOpen]);

  // Is ElevenLabs reachable at all? The answer only greys its radio card out;
  // the built-in AI voice and No Voiceover never depend on it.
  useEffect(() => {
    void syncElevenLabsAvailability();
    return subscribeElevenLabs(() => setElevenOffered(elevenLabsOffered()));
  }, []);

  // The session preference is the ONE source of truth for the voice source:
  // the pipeline reads it when it builds an audio plan, so the resolved
  // default is written down straight away rather than left implicit — the
  // selector and the plan can then never disagree about what was chosen.
  useEffect(() => {
    saveVoiceSourcePref(voiceSource);
    saveOpenAiVoicePref(openaiVoice);
  }, []);

  useEffect(() => {
    const handoff = consumeVidvergeHandoff('script-to-video');
    if (!handoff) return;
    if (handoff.projectId != null) {
      void db.getFilm(Number(handoff.projectId)).then((row) => { if (row) void openFilm(row); });
      return;
    }
    const attachment = handoff.attachment || null;
    const intake = handoff.scriptToVideo || null;
    const referenceLine = attachment && !attachment.type.startsWith('image/') ? `\n\nReference asset (${attachment.name}): ${attachment.url}` : '';
    setQuickText(`${String(intake?.generatedScript || handoff.prompt || '').trim()}${referenceLine}`.trim());
    setHandoffAttachment(attachment);
    setHandoffIntake(intake);
    const requestedModel = intake?.recommendedModel || handoff.videoModel;
    if (requestedModel) {
      const integrationModel = requestedModel === 'seedance-2.5' ? 'openrouter/bytedance/seedance-2.5'
        : requestedModel === 'omni-1.1-flash' ? 'gemini-omni-1.1-flash' : requestedModel;
      if (handoff.videoIntegration) saveVideoSelection(handoff.videoIntegration as any, integrationModel);
      try {
        window.sessionStorage.setItem('s2v:videoModel', requestedModel);
        window.sessionStorage.setItem('s2v:modelMode', intake?.routerMode === 'automatic' ? 'auto' : 'manual');
      } catch { /* preference only */ }
    }
    setScreen('create');
  }, []);

  /** Set legacy browser auto-generate for a film. New films stay paused for
   * plan review until the creator presses Start, which hands them to the
   * durable server runner instead of a browser timer. */
  function armAuto(filmId: number, on = readAutoPref(filmId)) {
    setAuto(on);
    autoRef.current = on;
    autoFiredFor.current = '';
  }

  // AUTO-GENERATE — PROMPT_READY is the pipeline's "a prepared clip is waiting
  // for a render trigger" state. Whenever the film sits there with
  // auto-generate on, generation starts by itself: no click, and no
  // requirement that the film have zero progress. The trigger re-arms for each
  // newly prepared scene, so a loop that ended early — a reload, a reopened
  // film, an auto-run interrupted by a failure the user then fixed — picks the
  // pipeline back up instead of stalling at PROMPT_READY. It polls rather than
  // keying off React state because the engine mutates its film/scene objects
  // in refs: a run ending is not itself a state change. The loop stays
  // strictly sequential through autoProduce (one clip at a time).
  // Provider generation and advancement are server-owned. The browser's only
  // recurring work is the read-only WorkspaceDB refresh for background jobs.

  // Track when the film entered its current machine_state. A film OPENED in a
  // state it was already sitting in keeps the row's own timestamp, so a render
  // abandoned an hour ago reads as stalled immediately; transitions made in
  // this session are timed from the transition.
  useEffect(() => {
    if (!film) return;
    const state = String(film.machine_state || '');
    const prev = stateSince.current;
    if (prev.id === film.id && prev.state === state) return;
    const rowAt = Date.parse(String(film.updated_at || ''));
    const openedHere = prev.id !== film.id && Number.isFinite(rowAt);
    stateSince.current = { id: film.id, state, at: openedHere ? rowAt : Date.now() };
  }, [film?.id, film?.machine_state, film?.updated_at]);

  // Frame extraction recovery is server-owned. No browser watchdog advances it.

  // Background progress is READ from WorkspaceDB; this interval never submits,
  // polls a provider or advances a stage. Closing the tab therefore has no
  // effect on production, and reopening simply adopts the durable checkpoint.
  useEffect(() => {
    if ((screen !== 'board' && screen !== 'final') || !film?.plan?.background?.enabled || film.status === 'ready') return;
    const filmId = film.id;
    let live = true;
    const refresh = async () => {
      try {
        const [fresh, freshScenes] = await Promise.all([db.getFilm(filmId), db.listScenes(filmId)]);
        if (!live || !fresh) return;
        try { await settlePendingBackgroundRefunds(fresh); }
        catch (refundError: any) { setError(String(refundError?.message || refundError)); }
        adopt(fresh, freshScenes);
        if (fresh.status === 'ready' && fresh.final_video_url) setScreen('final');
      } catch { /* the next read reconciles; the server keeps running */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, [film?.id, film?.status, film?.plan?.background?.enabled, screen]);

  // Final assembly adoption is server-owned. No browser timer submits a render.

  // Scene timeout recovery is server-owned. No browser watchdog retries providers.

  // The master URL reaches this component through the engine's onFilm patches,
  // so the suite-wide history is written from the film row rather than from
  // inside the assembly pipeline.
  useEffect(() => {
    const url = film?.final_video_url ? String(film.final_video_url) : '';
    if (!url || recordedVideoUrls.current.has(url)) return;
    recordedVideoUrls.current.add(url);
    void Promise.resolve({
      appId: 'script-to-video',
      title: film?.title || 'Script to Video film',
      videoUrl: url,
    });
  }, [film?.final_video_url, film?.title]);

  function adopt(f: Film, list: FilmScene[]) {
    // A film opened with its master already rendered was recorded when it
    // finished — reopening it must not add a second history row.
    if (f.final_video_url) recordedVideoUrls.current.add(String(f.final_video_url));
    engineFilm.current = f;
    engineScenes.current = list;
    setFilm({ ...f });
    setScenes(list.map((s) => ({ ...s })));
    // A film that already has an audio plan carries its own voice-source
    // decision: the selector shows THAT, not whatever was last picked here.
    // An older plan predates the choice, so it is ElevenLabs by definition —
    // reopening one must not silently drop narration it already recorded.
    const stored: VoiceSourceId = f.audio
      ? (f.audio.voice_source || 'elevenlabs')
      : f.plan?.narration_enabled === true ? 'elevenlabs' : 'none';
    setVoiceSource(stored); saveVoiceSourcePref(stored);
    if (f.audio?.openai_voice) { setOpenaiVoice(f.audio.openai_voice); saveOpenAiVoicePref(f.audio.openai_voice); }
  }

  /** Run one engine operation with the shared guards (single flight, error banner). */
  async function run(work: () => Promise<void>, opts: { block?: boolean } = {}) {
    if (running.current) return;
    running.current = true;
    if (opts.block) setBusy(true);
    setError('');
    try {
      await work();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      running.current = false;
      if (opts.block) setBusy(false);
    }
  }

  /** Plan edits are serialized instead of discarded when blur and a following
   * button click happen in the same gesture. Paid production still uses the
   * global single-flight guard; this queue exists only before plan approval. */
  function enqueuePlan(work: () => Promise<void>, _opts: { block?: boolean } = {}) {
    const task = planQueue.current.then(async () => {
      setBusy(true); setError('');
      try { await work(); }
      catch (e: any) { setError(String(e?.message || e)); }
      finally { setBusy(false); }
    });
    planQueue.current = task.catch(() => undefined);
    return task;
  }

  /** AUTO-ADVANCE — when the LAST scene completes (11/11 ✓ + continuity ✓),
   * move to the post-production view and, when Auto-complete post-production
   * is on, run narration → music → SFX automatically, THEN assemble the film.
   * Called inside run(), so the single-flight guard is held. */
  async function maybeAdvancePost() {
    const f = engineFilm.current;
    if (!f || f.plan?.background?.enabled || !allScenesDone(engineScenes.current)) return;
    if (advancedFor.current !== f.id) {
      advancedFor.current = f.id;
      if (f.status !== 'ready') setScreen('final');
    }
    if (autoPostRef.current && postKickedFor.current !== f.id && f.status !== 'ready' && !audioReady(f.audio)) {
      postKickedFor.current = f.id;
      await autoPostProduce(f, engineScenes.current, hooks);
    }
    await maybeAutoAssemble();
  }

  /** FINAL ASSEMBLY, WITHOUT A CLICK (bug D1). The last step of the pipeline
   * behaves like every step before it: once the scenes and the audio layers
   * are all ready, the film assembles itself. "Review before assembly" is the
   * opt-in that keeps the old pause. Called inside run(). */
  async function maybeAutoAssemble() {
    const f = engineFilm.current;
    if (!f || f.plan?.background?.enabled || reviewRef.current) return;
    if (assembleKickedFor.current === f.id) return;
    if (!readyToAutoAssemble(f, engineScenes.current)) return;
    assembleKickedFor.current = f.id;
    setNote('Everything is ready — assembling your final video…');
    await runFinalAssembly(f, engineScenes.current, hooks, { captions: captionsRef.current });
  }

  // ------- flow handlers -------

  async function startUnattendedProduction(targetFilm: Film, targetScenes: FilmScene[], reviewBeforeAssembly: boolean, includeCaptions: boolean) {
    const newlyCharged = await preauthorizeBackgroundScenes(targetFilm, targetScenes);
    try {
      const result = await callHook<{ success?: boolean; status?: string; error?: string }>('stv-scene-generate', {
        op: 'start', filmId: targetFilm.id, reviewBeforeAssembly, captions: includeCaptions,
      });
      if (!result?.success) {
        await Promise.all(newlyCharged.map((key) => refundCreditsStrict(key, 'Script-to-Video Start was rejected before any render submit')));
        throw new Error(result?.error || 'The background runner did not accept this film.');
      }
      return result;
    } catch (error: any) {
      const status = Math.round(Number(error?.status) || 0);
      if (status >= 400 && status < 500) {
        await Promise.all(newlyCharged.map((key) => refundCreditsStrict(key, 'Script-to-Video Start was rejected before any render submit')));
      }
      throw error;
    }
  }

  async function handleCreate(params: { mode?: CreateMode; script: string; aspect: any; targetDuration?: number; screenshotUrl: string | null; characterRefUrl?: string | null; note: string; videoModel?: string; styleLock?: boolean; audioEnabled?: boolean; narrationEnabled?: boolean; charactersSpeak?: boolean; entryType?: 'idea' | 'script'; controlMode?: ControlMode; executionMode?: ExecutionMode; videoStyle?: VideoStyleId; customVisualDirection?: string; audioPolicy?: AudioPolicy; maxAuthorizedCredits?: number; storyboardRequested?: boolean }) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    let foregroundAutomatic = false;
    let foregroundAutomaticFilmId: number | null = null;
    try {
      // Manual Script Mode skips scene detection and the directing pass
      // entirely: the pasted script already says what every clip is.
      const res = params.mode === 'manual'
        ? await createManualScriptFilm({ script: params.script, aspect: params.aspect, targetDuration: params.targetDuration, characterRefUrl: params.characterRefUrl || null, referenceImageUrl: params.screenshotUrl, note: params.note, videoModel: params.videoModel, styleLock: params.styleLock !== false, audioEnabled: params.audioEnabled !== false, narrationEnabled: params.narrationEnabled === true, charactersSpeak: params.charactersSpeak === true, entryType: params.entryType, controlMode: params.controlMode, executionMode: params.executionMode, videoStyle: params.videoStyle, customVisualDirection: params.customVisualDirection, audioPolicy: params.audioPolicy, maxAuthorizedCredits: params.maxAuthorizedCredits, storyboardRequested: params.storyboardRequested }, hooks)
        : await createAndSegmentFilm({ script: params.script, aspect: params.aspect, targetDuration: params.targetDuration, referenceImageUrl: params.screenshotUrl, characterRefUrl: params.characterRefUrl || null, note: params.note, videoModel: params.videoModel, styleLock: params.styleLock !== false, audioEnabled: params.audioEnabled !== false, narrationEnabled: params.narrationEnabled === true, charactersSpeak: params.charactersSpeak === true, entryType: params.entryType, controlMode: params.controlMode, executionMode: params.executionMode, videoStyle: params.videoStyle, customVisualDirection: params.customVisualDirection, audioPolicy: params.audioPolicy, maxAuthorizedCredits: params.maxAuthorizedCredits, storyboardRequested: params.storyboardRequested }, hooks);
      let createdFilm = res.film;
      if (params.storyboardRequested && createdFilm.plan) {
        const storyboardPlan = { ...createdFilm.plan, storyboard_requested: true } as typeof createdFilm.plan;
        await db.updateFilm(createdFilm.id, { plan: storyboardPlan });
        createdFilm = { ...createdFilm, plan: storyboardPlan };
        for (const plannedScene of res.scenes) await generateStoryboardFrame(createdFilm, plannedScene);
      }
      if (params.executionMode === 'automatic' && createdFilm.plan) {
        const cast = (createdFilm.character_refs || []).map((character) => ({ ...character, approved: Boolean(character.url) }));
        const missing = cast.filter((character) => !character.url);
        const plan = {
          ...createdFilm.plan,
          cast_reviewed: missing.length === 0,
          orchestration: createdFilm.plan.orchestration ? { ...createdFilm.plan.orchestration, state: missing.length ? 'blocked' as const : 'auto_authorized' as const, checkpoint: missing.length ? 'character_reference_required' : 'auto_authorized', updated_at: new Date().toISOString() } : createdFilm.plan.orchestration,
        };
        await db.updateFilm(createdFilm.id, { character_refs: cast, plan });
        createdFilm = { ...createdFilm, character_refs: cast, plan };
        if (!missing.length) {
          foregroundAutomatic = res.scenes.some((scene) => {
            const provider = resolveVideoModel((scene.spec as any)?.engine_id || createdFilm.video_model).provider;
            return provider === 'kling' || provider === 'openrouter';
          });
          if (!foregroundAutomatic) {
            await startUnattendedProduction(createdFilm, res.scenes, false, false);
            createdFilm = (await db.getFilm(createdFilm.id)) || createdFilm;
          }
        }
      }
      const freshScenes = await db.listScenes(createdFilm.id);
      adopt(createdFilm, freshScenes);
      advancedFor.current = null; postKickedFor.current = null;
      assembleKickedFor.current = null;
      stallRetriedScenes.current = new Set();
      frameRecoveryFor.current = null;
      stateSince.current = { id: 0, state: '', at: 0 };
      armAuto(res.film.id, foregroundAutomatic);
      writeAutoPref(res.film.id, foregroundAutomatic);
      reviewRef.current = false;
      setScreen('board');
      if (foregroundAutomatic) foregroundAutomaticFilmId = res.film.id;
    } catch (e: any) { foregroundAutomaticFilmId = null; setError(String(e?.message || e)); }
    finally { running.current = false; setBusy(false); }
    if (foregroundAutomaticFilmId != null) {
      window.setTimeout(() => {
        const activeFilm = engineFilm.current;
        if (!activeFilm || activeFilm.id !== foregroundAutomaticFilmId || running.current) return;
        void run(async () => {
          setNote('Signed-in automatic production is running — keep this tab open while Kling or Seedance submits and polls.');
          await autoProduce(activeFilm, engineScenes.current, hooks, () => autoRef.current);
          await maybeAdvancePost();
        }, { block: true });
      }, 0);
    }
  }

  async function persistCast(next: FilmCharacter[], reviewed = next.length > 0 && next.every((character) => character.approved && character.url)) {
    const f = engineFilm.current;
    if (!f?.plan) return;
    const characters = next.map(({ url: _url, approved: _approved, source: _source, source_reference_id: _sourceReferenceId, image_error: _imageError, image_model: _imageModel, ...profile }) => profile);
    const plan = { ...f.plan, characters, cast_reviewed: reviewed };
    await db.updateFilm(f.id, { character_refs: next, plan });
    Object.assign(f, { character_refs: next, plan });
    setFilm({ ...f });
    if (reviewed) {
      const stored = await db.listReferences().catch(() => [] as StoredReference[]);
      for (const character of next) {
        if (!character.url) continue;
        const name = referenceSlug(character.name || character.id);
        if (!name || stored.some((ref) => ref.name === name)) continue;
        await db.addReference({
          name,
          display_name: character.name,
          url: character.url,
          type: 'character',
          description: [character.role, character.appearance, character.wardrobe].filter(Boolean).join(' · ').slice(0, 800),
        }).catch(() => null);
      }
    }
  }

  async function handleUpdateCharacter(id: string, patch: Partial<FilmCharacter>) {
    const current = Array.isArray(engineFilm.current?.character_refs) ? engineFilm.current!.character_refs! : [];
    const next = current.map((character) => character.id === id ? { ...character, ...patch } : character);
    await run(() => persistCast(next), { block: true });
  }

  async function handleAddCharacter() {
    const current = Array.isArray(engineFilm.current?.character_refs) ? engineFilm.current!.character_refs! : [];
    const id = `character_${Date.now().toString(36)}`;
    const next: FilmCharacter[] = [...current, {
      id, name: 'New character', kind: 'main', role: 'Main character', age_appearance: 'Adult; edit appearance details', wardrobe: 'Edit wardrobe', personality_voice: 'Natural, grounded delivery',
      voice: { tone: 'natural', accent: 'neutral', pace: 'conversational' }, appearance: 'Edit the locked appearance used in every block',
      coverage: [], inferred_fields: ['role', 'age_appearance', 'wardrobe', 'personality_voice', 'voice', 'appearance'], url: null, approved: false, source: 'uploaded',
    }];
    await run(() => persistCast(next, false), { block: true });
  }

  async function handleRemoveCharacter(id: string) {
    const current = Array.isArray(engineFilm.current?.character_refs) ? engineFilm.current!.character_refs! : [];
    await run(() => persistCast(current.filter((character) => character.id !== id), false), { block: true });
  }

  async function handleRegenerateCharacter(id: string, quality: 'draft' | 'premium' = 'draft') {
    const f = engineFilm.current;
    const character = f?.character_refs?.find((item) => item.id === id);
    if (!f || !character) return;
    await run(async () => {
      try {
        const url = await generateBackdropImage(characterPortraitBrief(character, String(f.plan?.visual_style || f.plan?.style_direction || '')), '1:1', quality);
        const next = (f.character_refs || []).map((item) => item.id === id ? { ...item, url, approved: false, source: 'generated' as const, image_error: undefined, image_model: quality === 'premium' ? 'premium image route' : 'gemini-3.1-flash-image' } : item);
        await db.addAsset({ film_id: f.id, kind: 'character', name: `${character.name} character sheet`, description: character.appearance.slice(0, 200), url, tags: [quality, 'cast-sheet'] });
        await persistCast(next, false);
      } catch (caught: any) {
        const message = friendlyAppError(caught?.message || caught);
        const next = (f.character_refs || []).map((item) => item.id === id ? { ...item, approved: false, image_error: message } : item);
        await persistCast(next, false);
        throw new Error(message);
      }
    }, { block: true });
  }

  async function handleGenerateMissingCast() {
    const f = engineFilm.current;
    const missing = (f?.character_refs || []).filter((character) => !character.url);
    if (!f || !missing.length) return;
    await run(async () => {
      let current = [...(f.character_refs || [])];
      const failures: string[] = [];
      for (const character of missing) {
        try {
          const url = await generateBackdropImage(characterPortraitBrief(character, String(f.plan?.visual_style || f.plan?.style_direction || '')), '1:1', 'draft');
          current = current.map((item) => item.id === character.id ? { ...item, url, approved: false, source: 'generated' as const, image_error: undefined, image_model: 'gemini-3.1-flash-image' } : item);
          await db.addAsset({ film_id: f.id, kind: 'character', name: `${character.name} character sheet`, description: character.appearance.slice(0, 200), url, tags: ['draft', 'cast-sheet'] });
        } catch (caught: any) {
          const message = friendlyAppError(caught?.message || caught);
          failures.push(character.name);
          current = current.map((item) => item.id === character.id ? { ...item, approved: false, image_error: message } : item);
        }
        await persistCast(current, false);
      }
      if (failures.length) throw new Error(`${failures.join(', ')} still need an image. Retry individually, upload your own, reuse an existing sheet, or remove the character.`);
    }, { block: true });
  }

  async function handleUploadCharacter(id: string, file: File) {
    const f = engineFilm.current;
    if (!f) return;
    await run(async () => {
      const url = await VideoModelService.uploadReference(file, file.name);
      const next = (f.character_refs || []).map((item) => item.id === id ? { ...item, url, approved: false, source: 'uploaded' as const, image_error: undefined, image_model: 'uploaded' } : item);
      await persistCast(next, false);
    }, { block: true });
  }

  async function handleReuseCharacter(id: string, reference: StoredReference) {
    const f = engineFilm.current;
    if (!f) return;
    await run(() => persistCast((f.character_refs || []).map((item) => item.id === id ? {
      ...item, url: reference.url, approved: false, source: 'library' as const, source_reference_id: reference.id, image_error: undefined, image_model: 'library',
    } : item), false), { block: true });
  }

  async function handleConfirmEmptyCast() {
    await run(() => persistCast([], true), { block: true });
  }

  function planCanChange(): boolean {
    const f = engineFilm.current;
    return Boolean(f && !f.plan?.background?.enabled && engineScenes.current.every((scene) => scene.status === 'waiting' || scene.status === 'ready'));
  }

  function handleUpdatePlanScene(scene: FilmScene, patch: Record<string, unknown>) {
    void enqueuePlan(async () => {
      const f = engineFilm.current;
      const target = engineScenes.current.find((item) => item.id === scene.id);
      if (!f?.plan || !target || (!planCanChange() && target.status !== 'failed')) throw new Error('The production plan is locked after paid generation starts. Only the affected failed scene can change model before its retry.');
      const currentSpec = { ...(target.spec as any) };
      const nextModelId = String(patch.engine_id || currentSpec.engine_id || f.video_model || '');
      const model = resolveVideoModel(nextModelId);
      const duration = Math.round(Number(patch.duration_s ?? target.duration_s) || 0);
      if (duration < Number(model.minDuration || 1) || duration > model.safeMaxDuration || (model.discreteDurations && !model.supportedDurations.includes(duration))) {
        throw new Error(`${model.label} supports ${model.discreteDurations ? model.supportedDurations.join('s or ') + 's' : `${model.minDuration || 1}–${model.safeMaxDuration}s`} per block. Split the scene instead of truncating it.`);
      }
      const nextDialogueLine = patch.dialogue_line !== undefined ? String(patch.dialogue_line) : String(target.dialogue?.line || '');
      if (target.dialogue?.kind === 'character' && nextDialogueLine.trim() && !model.audioSupported) {
        throw new Error(`${model.label} is silent on the connected adapter, but this scene requires visible character speech. Choose Seedance 2.5, or Gemini Omni 1.1 Flash for a block of 8 seconds or less.`);
      }
      const spec = {
        ...currentSpec,
        ...(patch.summary !== undefined ? { summary: String(patch.summary) } : {}),
        ...(patch.visual_goal !== undefined ? { visual_goal: String(patch.visual_goal) } : {}),
        ...(patch.camera !== undefined ? { camera: String(patch.camera) } : {}),
        ...(patch.environment !== undefined ? { environment: String(patch.environment) } : {}),
        ...(patch.sound !== undefined ? { sound: String(patch.sound) } : {}),
        ...(patch.continuity_notes !== undefined ? { continuity_notes: String(patch.continuity_notes) } : {}),
        ...(patch.characters !== undefined ? { characters: String(patch.characters).split(',').map((item) => item.trim()).filter(Boolean) } : {}),
        ...(patch.timed_beats !== undefined && Array.isArray(patch.timed_beats) ? { timed_beats: patch.timed_beats } : {}),
        engine_id: nextModelId,
        engine_reason: String(patch.engine_reason || `Creator-approved ${model.label} assignment.`),
      };
      const previousProductReference = String((currentSpec as any).product_reference_url || '');
      const referenceUrl = String(patch.reference_url || '').trim();
      const retainedReferences = (target.reference_assets || []).filter((asset) => asset.url !== previousProductReference);
      const reference_assets = patch.reference_url !== undefined
        ? (referenceUrl && !retainedReferences.some((asset) => asset.url === referenceUrl) ? [...retainedReferences, { role: 'reference' as const, url: referenceUrl }] : retainedReferences)
        : target.reference_assets;
      if (patch.reference_url !== undefined) (spec as any).product_reference_url = referenceUrl;
      const dialogue = patch.dialogue_line !== undefined ? {
        ...(target.dialogue || { kind: 'narrator' as const, speaker: 'Narrator', delivery: 'natural', language: 'English' }),
        line: String(patch.dialogue_line),
      } : target.dialogue;
      const editedPrompt = patch.prompt !== undefined ? String(patch.prompt).trim() : '';
      const rowPatch: Partial<FilmScene> = {
        duration_s: duration,
        script_segment: patch.script_segment !== undefined ? String(patch.script_segment) : target.script_segment,
        dialogue,
        spec,
        reference_assets,
        prompt: editedPrompt || null,
        status: editedPrompt ? 'ready' : 'waiting',
        error: null,
      };
      const plannedScenes = (f.plan.scenes || []).map((item) => item.scene_key === target.scene_key ? {
        ...item, duration_s: duration, script_segment: rowPatch.script_segment || '', dialogue, spec,
        summary: String(spec.summary || item.summary || ''), visual_goal: String(spec.visual_goal || item.visual_goal || ''),
      } : item);
      const plan = { ...f.plan, scenes: plannedScenes };
      await Promise.all([db.updateScene(target.id, rowPatch), db.updateFilm(f.id, { plan, status: 'plan_ready', machine_state: 'PREPARING_SCENE' })]);
      Object.assign(target, rowPatch); Object.assign(f, { plan, status: 'plan_ready', machine_state: 'PREPARING_SCENE' });
      setScenes([...engineScenes.current]); setFilm({ ...f });
    }, { block: true });
  }

  async function generateStoryboardFrame(f: Film, target: FilmScene) {
    if (!f.plan || f.plan.background?.enabled) throw new Error('Storyboards can only change before paid production starts.');
    const spec = { ...(target.spec as any), storyboard_status: 'loading', storyboard_error: null };
    await db.updateScene(target.id, { spec });
    Object.assign(target, { spec });
    try {
      const written = await askOpusJson<{ caption: string; prompt: string }>({
        system: `You write one human-review storyboard still for a production plan. Reply only with JSON: {"caption":string,"prompt":string}. The caption is a short literal description of the scene beat. The image prompt states every visible character's locked identity and frame position, one physically realistic action, object contact, camera framing/lens, motivated light source, setting and end pose. Preserve the approved visual style. Ban vague filler, teleporting, sudden appearances, morphing, text, captions, logos, interfaces, watermarks and unrequested objects. This still is review-only and must never be described as a video-model reference.`,
        user: `FILM: ${f.title || 'Untitled film'}\nSTYLE: ${f.plan.custom_visual_direction || f.plan.visual_style || f.plan.style_direction || 'cinematic live action'}\nSCENE ${target.idx + 1}: ${spec.visual_goal || spec.summary || target.script_segment}\nCAST: ${JSON.stringify((f.character_refs || []).filter((character) => (spec.characters || []).includes(character.id)).map((character) => ({ id: character.id, name: character.name, appearance: character.appearance, wardrobe: character.wardrobe })))}`,
        maxTokens: 16000,
        effort: 'xhigh',
      });
      const storyboardUrl = await generateBackdropImage(written.prompt, (f.aspect_ratio || '16:9') as any, 'draft');
      const nextSpec = { ...spec, storyboard_url: storyboardUrl, storyboard_caption: written.caption, storyboard_only: true, storyboard_status: 'ready', storyboard_error: null, storyboard_approved: false };
      await Promise.all([
        db.updateScene(target.id, { spec: nextSpec }),
        db.addAsset({ film_id: f.id, kind: 'storyboard', name: `Scene ${target.idx + 1} storyboard`, description: String(spec.visual_goal || spec.summary || '').slice(0, 200), url: storyboardUrl, tags: ['storyboard-only', 'human-review'] }),
      ]);
      Object.assign(target, { spec: nextSpec });
      const plan = { ...f.plan, storyboard_requested: true, storyboard_only_asset_ids: Array.from(new Set([...(f.plan.storyboard_only_asset_ids || []), storyboardUrl])) } as typeof f.plan;
      await db.updateFilm(f.id, { plan });
      Object.assign(f, { plan });
    } catch (caught: any) {
      const failedSpec = { ...spec, storyboard_status: 'error', storyboard_error: String(caught?.message || caught), storyboard_approved: false };
      await db.updateScene(target.id, { spec: failedSpec });
      Object.assign(target, { spec: failedSpec });
      throw new Error(`Storyboard scene ${target.idx + 1} failed: ${String(caught?.message || caught)} Retry that frame before production.`);
    }
  }

  async function handleGenerateStoryboard(scene: FilmScene) {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f?.plan || !target || f.plan.background?.enabled) return;
    await run(async () => {
      await generateStoryboardFrame(f, target);
      setScenes([...engineScenes.current]); setFilm({ ...f });
    }, { block: true });
  }

  async function handleApproveStoryboard(scene: FilmScene) {
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!target) return;
    await run(async () => {
      const spec = { ...(target.spec as any), storyboard_approved: true };
      await db.updateScene(target.id, { spec });
      Object.assign(target, { spec });
      setScenes([...engineScenes.current]);
    });
  }

  function handleMovePlanScene(scene: FilmScene, direction: -1 | 1) {
    void enqueuePlan(async () => {
      const f = engineFilm.current;
      if (!f?.plan || !planCanChange()) throw new Error('Reordering is available only before paid generation starts.');
      const ordered = [...engineScenes.current].sort((a, b) => a.idx - b.idx);
      const from = ordered.findIndex((item) => item.id === scene.id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ordered.length) return;
      [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
      for (let index = 0; index < ordered.length; index += 1) { ordered[index].idx = index; await db.updateScene(ordered[index].id, { idx: index }); }
      const positions = new Map(ordered.map((item) => [item.scene_key, item.idx]));
      const plan = { ...f.plan, scenes: (f.plan.scenes || []).map((item) => ({ ...item, idx: positions.get(item.scene_key) ?? item.idx })).sort((a, b) => a.idx - b.idx) };
      await db.updateFilm(f.id, { plan }); Object.assign(f, { plan }); engineScenes.current = ordered; setScenes([...ordered]); setFilm({ ...f });
    }, { block: true });
  }

  function handleAddPlanScene(after: FilmScene) {
    void enqueuePlan(async () => {
      const f = engineFilm.current;
      if (!f?.plan || !planCanChange()) throw new Error('Adding a scene is available only before paid generation starts.');
      const ordered = [...engineScenes.current].sort((a, b) => a.idx - b.idx);
      for (const item of [...ordered].reverse()) if (item.idx > after.idx) { item.idx += 1; await db.updateScene(item.id, { idx: item.idx }); }
      const scene_key = newSceneKey();
      const addedModelId = String(f.video_model || 'omni-1.1-flash');
      const addedModel = resolveVideoModel(addedModelId);
      const defaultDuration = addedModel.discreteDurations ? (addedModel.supportedDurations[0] || 5) : Math.max(Number(addedModel.minDuration || 2), Math.min(6, addedModel.safeMaxDuration));
      const spec = { summary: 'New planned beat', visual_goal: 'Describe the visual objective', engine_id: addedModelId, engine_reason: 'Creator-added scene; review the assignment before approval.' };
      await db.insertScene({ film_id: f.id, idx: after.idx + 1, scene_key, type: 'video_clip', script_segment: 'Add dialogue or voice-over for this beat.', spec, status: 'waiting', duration_s: defaultDuration, continuity_group: null, prompt: null });
      const plan = { ...f.plan, scenes: [...(f.plan.scenes || []).map((item) => item.idx > after.idx ? { ...item, idx: item.idx + 1 } : item), { scene_key, idx: after.idx + 1, type: 'video_clip' as const, script_segment: 'Add dialogue or voice-over for this beat.', duration_s: defaultDuration, continuity_group: null, summary: 'New planned beat', visual_goal: 'Describe the visual objective', spec }].sort((a, b) => a.idx - b.idx) };
      await db.updateFilm(f.id, { plan }); Object.assign(f, { plan }); const fresh = await db.listScenes(f.id); engineScenes.current = fresh; setScenes([...fresh]); setFilm({ ...f });
    }, { block: true });
  }

  function handleDeletePlanScene(scene: FilmScene) {
    void enqueuePlan(async () => {
      const f = engineFilm.current;
      if (!f?.plan || !planCanChange()) throw new Error('Deleting a scene is available only before paid generation starts.');
      if (engineScenes.current.length <= 1) throw new Error('A film needs at least one scene.');
      await db.deleteScene(scene.id);
      const remaining = engineScenes.current.filter((item) => item.id !== scene.id).sort((a, b) => a.idx - b.idx);
      for (let index = 0; index < remaining.length; index += 1) { remaining[index].idx = index; await db.updateScene(remaining[index].id, { idx: index }); }
      const positions = new Map(remaining.map((item) => [item.scene_key, item.idx]));
      const plan = { ...f.plan, scenes: (f.plan.scenes || []).filter((item) => item.scene_key !== scene.scene_key).map((item) => ({ ...item, idx: positions.get(item.scene_key) ?? item.idx })).sort((a, b) => a.idx - b.idx) };
      await db.updateFilm(f.id, { plan }); Object.assign(f, { plan }); engineScenes.current = remaining; setScenes([...remaining]); setFilm({ ...f });
    }, { block: true });
  }

  async function handlePauseBackground(paused: boolean) {
    const f = engineFilm.current;
    if (!f?.plan?.background?.enabled || !f.plan.orchestration) return;
    await run(async () => {
      const plan = { ...f.plan, orchestration: { ...f.plan!.orchestration!, paused, state: paused ? 'resumable' as const : 'queued' as const, checkpoint: paused ? 'paused_after_current_job' : 'resume_requested', updated_at: new Date().toISOString() } };
      await db.updateFilm(f.id, { plan, stage_note: paused ? 'Paused — the current provider job may finish, but no future block will be submitted.' : 'Resume requested — the durable worker will continue from the saved checkpoint.' });
      Object.assign(f, { plan, stage_note: paused ? 'Paused — the current provider job may finish, but no future block will be submitted.' : 'Resume requested — the durable worker will continue from the saved checkpoint.' });
      setFilm({ ...f });
      if (!paused) await callHook('s2v-recovery-sweeper', { op: 'tick', film_id: f.id, chain_id: f.plan?.background?.chain_id, source: 'creator-resume' });
    }, { block: true });
  }

  async function handleStopFutureJobs() {
    const f = engineFilm.current;
    if (!f?.plan?.background?.enabled || !f.plan.orchestration) return;
    if (!window.confirm('Stop every future job for this production? A provider job already submitted may still finish and be billed; completed clips stay saved.')) return;
    await run(async () => {
      const plan = { ...f.plan, orchestration: { ...f.plan!.orchestration!, cancel_requested: true, state: 'cancelled' as const, checkpoint: 'stop_future_jobs_requested', updated_at: new Date().toISOString() } };
      await db.updateFilm(f.id, { plan, status: 'cancelled', stage_note: 'Future jobs stopped. Completed clips remain saved; an already-submitted provider job may still settle.' });
      Object.assign(f, { plan, status: 'cancelled' as const, stage_note: 'Future jobs stopped. Completed clips remain saved; an already-submitted provider job may still settle.' });
      setFilm({ ...f });
    }, { block: true });
  }

  async function handleFixAudioModels() {
    const f = engineFilm.current;
    if (!f?.plan || running.current) return;
    await run(async () => {
      const changed = new Map<string, any>();
      for (const scene of engineScenes.current) {
        const dialogue = scene.dialogue;
        const currentSpec = { ...(scene.spec as any) };
        const currentModel = resolveVideoModel(currentSpec.engine_id || f.video_model);
        const needsNativeSpeech = dialogue?.kind === 'character' && Boolean(String(dialogue.line || '').trim());
        const durableSupported = [SEEDANCE_2_5.id, 'seedance-2.0', 'kling-3.0', 'kling-3.0-omni', VideoModelService.config.id].includes(currentModel.id);
        if ((!needsNativeSpeech || currentModel.audioSupported) && durableSupported) continue;
        const recommended = needsNativeSpeech || Number(scene.duration_s || 0) > VideoModelService.config.safeMaxDuration ? SEEDANCE_2_5 : VideoModelService.config;
        const reason = needsNativeSpeech
          ? `${recommended.label} selected because this scene requires native character speech and ${currentModel.label} is silent.`
          : `${recommended.label} selected because ${currentModel.label} is not supported by the durable background runner.`;
        const spec = {
          ...currentSpec,
          engine_id: recommended.id,
          engine_reason: reason,
          model_assignment: { model_id: recommended.apiModel, operation: 'generate', locked: false, reason },
          prompt_version: Number(currentSpec.prompt_version || 1) + 1,
        };
        await db.updateScene(scene.id, { spec, prompt: null, status: 'waiting', error: null });
        Object.assign(scene, { spec, prompt: null, status: 'waiting', error: null });
        changed.set(scene.scene_key, { spec, model: recommended });
      }
      if (!changed.size) return;
      const plan = { ...f.plan, scenes: (f.plan.scenes || []).map((scene) => changed.has(scene.scene_key) ? { ...scene, spec: changed.get(scene.scene_key).spec } : scene), scene_plan_version: Number(f.plan.scene_plan_version || 1) + 1 };
      const models = Array.from(changed.values()).map((entry) => entry.model);
      const filmModel = models.some((model) => model.id === SEEDANCE_2_5.id) ? SEEDANCE_2_5 : VideoModelService.config;
      const stageNote = `${changed.size} incompatible scene model${changed.size === 1 ? '' : 's'} corrected. Timing and wording are unchanged; review the provider cost, then Start.`;
      await db.updateFilm(f.id, { plan, video_model: filmModel.id, stage_note: stageNote });
      Object.assign(f, { plan, video_model: filmModel.id, stage_note: stageNote });
      setScenes([...engineScenes.current]); setFilm({ ...f });
    }, { block: true });
  }

  async function handleStartBackground() {
    const f = engineFilm.current;
    if (!f || running.current) return;
    await run(async () => {
      const cast = Array.isArray(f.character_refs) ? f.character_refs : [];
      if (f.plan?.cast_reviewed !== true || cast.some((character) => !character.approved || !character.url)) {
        throw new Error(cast.length
          ? 'Approve every retained character sheet before Start. Regenerate or upload any missing sheet first.'
          : 'Confirm that this script needs no cast, or add a character, before Start.');
      }
      const signedInTabRequired = requiresSignedInVideoTab(f, engineScenes.current);
      if (signedInTabRequired) {
        // Kling and Seedance proxies require the current signed-in workspace
        // token. Every scene still routes through stv-scene-generate, whose
        // vv-credits charge key deducts this customer's own balance exactly
        // once; the provider proxy separately bills the workspace wallet.
        setNote('Starting signed-in production — keep this tab open while Kling or Seedance submits and polls…');
        armAuto(f.id, true);
        writeAutoPref(f.id, true);
        await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
        await maybeAdvancePost();
        setNote(allScenesDone(engineScenes.current) ? 'All signed-in video scenes are complete.' : 'Signed-in production paused at the next action. Your completed scenes and credit receipts are saved.');
        return;
      }
      setNote('Starting unattended production…');
      await startUnattendedProduction(f, engineScenes.current, reviewRef.current, captionsRef.current);
      armAuto(f.id, false);
      writeAutoPref(f.id, false);
      const [fresh, freshScenes] = await Promise.all([db.getFilm(f.id), db.listScenes(f.id)]);
      if (fresh) adopt(fresh, freshScenes);
      setNote('Production is running in the background. You can close this tab.');
    }, { block: true });
  }

  const withEngine = (fn: (f: Film, list: FilmScene[], scene: FilmScene) => Promise<void>) => (scene: FilmScene) => {
    const f = engineFilm.current;
    const engineScene = engineScenes.current.find((s) => s.id === scene.id);
    if (!f || !engineScene) return;
    void run(async () => {
      await fn(f, engineScenes.current, engineScene);
      if (autoRef.current) await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
      await maybeAdvancePost();
    });
  };

  const handleGenerate = withEngine((f, list, s) => generateScene(f, list, s, hooks));
  const handlePrepare = withEngine((f, list, s) => prepareScene(f, list, s, hooks));
  const handleRetry = withEngine((f, list, s) => retryScene(f, list, s, hooks));
  const handleRetryFrame = (scene: FilmScene) => {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f || !target) return;
    void run(async () => {
      await retryFinalFrame(f, engineScenes.current, target, hooks);
      if (f.plan?.background?.enabled && target.status === 'completed') {
        await callHook('s2v-recovery-sweeper', { op: 'tick', film_id: f.id, chain_id: f.plan.background.chain_id, source: 'creator-retried-frame' });
      }
      await maybeAdvancePost();
    });
  };
  const handleContinueWithoutFrame = (scene: FilmScene) => {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f || !target) return;
    void run(async () => {
      await continueWithoutContinuityFrame(f, engineScenes.current, target, hooks);
      if (f.plan?.background?.enabled) {
        await callHook('s2v-recovery-sweeper', { op: 'tick', film_id: f.id, chain_id: f.plan.background.chain_id, source: 'creator-continued-without-frame' });
      } else if (autoRef.current) {
        await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
      }
      await maybeAdvancePost();
    });
  };
  const handleRegenPrompt = withEngine((f, list, s) => regenerateScenePrompt(f, list, s, hooks));

  /** [Redo this scene] — a TRUE redo for a completed scene: Opus writes a
   * fresh prompt AND the clip re-renders immediately, with no dependency on
   * the auto-generate toggle and no second click. The old wiring only rewrote
   * the prompt (silently doing nothing at all while the pipeline was busy),
   * which read as a broken button. Other scenes are never touched. */
  function handleRedo(scene: FilmScene) {
    const f = engineFilm.current;
    const engineScene = engineScenes.current.find((s) => s.id === scene.id);
    if (!f || !engineScene) return;
    if (running.current) {
      setError('The pipeline is busy with another step — wait for it to finish, then redo the scene.');
      return;
    }
    const extraSeconds = Math.max(1, Math.round(Number(engineScene.duration_s) || 0));
    if (!window.confirm(`Regenerate only scene ${engineScene.idx + 1}?\n\nAffected scenes: ${engineScene.idx + 1} only. Approved scenes stay unchanged. Extra authorization: up to ${extraSeconds} video credit${extraSeconds === 1 ? '' : 's'} plus any provider cost shown by the selected model.`)) return;
    setRedoingId(scene.id);
    void run(async () => {
      try {
        await regenerateScenePrompt(f, engineScenes.current, engineScene, hooks);
        await generateScene(f, engineScenes.current, engineScene, hooks);
      } finally {
        setRedoingId(null);
      }
      if (autoRef.current) await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
      await maybeAdvancePost();
    });
  }
  const handleSkip = withEngine((f, list, s) => skipScene(f, list, s, hooks));

  function handleCharacterDialogueFallback(scene: FilmScene) {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f || !target || running.current) return;
    setDialogueAudioSceneId(target.id);
    void run(async () => {
      try {
        const narration = await generateCharacterDialogueFallback(f, target, setNote);
        const validation = {
          ...(target.validation || {}),
          character_dialogue_fallback: {
            provider: 'elevenlabs',
            voice_id: narration.voiceId,
            measured_duration_s: narration.duration_s,
            created_at: new Date().toISOString(),
          },
        } as any;
        await db.updateScene(target.id, { narration, validation });
        Object.assign(target, { narration, validation });
        setScenes((items) => items.map((item) => item.id === target.id ? { ...item, narration, validation } : item));
        setNote(`Scene ${target.idx + 1} character voice is ready. Final Assembly will mix this line only; no video scene was regenerated.`);
      } finally {
        setDialogueAudioSceneId(null);
      }
    });
  }

  async function handleOmniEdit(scene: FilmScene, instruction: string) {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f || !target?.asset_url || f.plan?.background?.enabled || running.current) return;
    setEditingId(target.id);
    await run(async () => {
      try {
        const result = await VideoModelService.editVideo({
          sourceUrl: target.asset_url!, instruction,
          aspect: (f.aspect_ratio || '16:9') as any,
          durationS: Number(target.duration_s) || 0,
          creditKey: `stv:film:${f.id}:scene:${target.id}:omni-edit:${Date.now()}`,
          generateAudio: f.plan?.audio_enabled !== false,
        });
        const validation = { ...(target.validation || {}) } as NonNullable<FilmScene['validation']>;
        const revision = {
          id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          before_url: String(target.asset_url), after_url: result.videoUrl,
          before_keyframe_url: target.keyframe_url || null, after_keyframe_url: null,
          instruction: instruction.trim(), model: result.model,
          edited_window_s: result.editedWindowSec,
          preserved_remainder_s: result.preservedRemainderSec,
          assembled_from_window: result.assembledFromWindow,
          boundary_evidence: result.boundaryEvidence,
          operation_id: result.operationId,
          incremental_cost: 'provider receipt pending reconciliation',
          status: 'preview' as const, created_at: new Date().toISOString(),
        };
        validation.original_url = validation.original_url || String(target.asset_url);
        validation.active_revision_id = revision.id;
        validation.revisions = [...(validation.revisions || []), revision];
        await db.updateScene(target.id, { validation });
        Object.assign(target, { validation });
        setScenes((items) => items.map((item) => item.id === target.id ? { ...item, validation } : item));
      } finally { setEditingId(null); }
    });
  }

  async function handleAcceptRevision(scene: FilmScene, revisionId: string) {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f || !target) return;
    await run(async () => {
      const validation = { ...(target.validation || {}) } as NonNullable<FilmScene['validation']>;
      const revisions = [...(validation.revisions || [])];
      const selected = revisions.find((revision) => revision.id === revisionId);
      if (!selected) throw new Error('That edit revision is no longer available.');
      validation.revisions = revisions.map((revision) => ({ ...revision, status: revision.id === revisionId ? 'accepted' as const : revision.status === 'accepted' ? 'undone' as const : revision.status }));
      validation.active_revision_id = revisionId;
      validation.continuity_review_required = true;
      await db.updateScene(target.id, { asset_url: selected.after_url, keyframe_url: null, validation });
      Object.assign(target, { asset_url: selected.after_url, keyframe_url: null, validation });
      setScenes((items) => items.map((item) => item.id === target.id ? { ...item, asset_url: selected.after_url, keyframe_url: null, validation } : item));
      await retryFinalFrame(f, engineScenes.current, target, hooks);
      const filmPatch: Partial<Film> = { final_video_url: null, final_thumb_url: null, status: 'producing', machine_state: allScenesDone(engineScenes.current) ? 'ALL_SCENES_COMPLETED' : f.machine_state, stage_note: target.status === 'needs_action' ? `Scene ${target.idx + 1} edit accepted. Retry its continuity frame before any later scene can run.` : `Scene ${target.idx + 1} edit accepted and its new outgoing frame was validated.`, error: null };
      await db.updateFilm(f.id, filmPatch); Object.assign(f, filmPatch); setFilm({ ...f });
    }, { block: true });
  }

  async function handleUndoRevision(scene: FilmScene, revisionId: string) {
    const f = engineFilm.current;
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!f || !target) return;
    await run(async () => {
      const validation = { ...(target.validation || {}) } as NonNullable<FilmScene['validation']>;
      const revisions = [...(validation.revisions || [])];
      const selected = revisions.find((revision) => revision.id === revisionId);
      if (!selected) throw new Error('That edit revision is no longer available.');
      validation.revisions = revisions.map((revision) => revision.id === revisionId ? { ...revision, status: 'undone' as const } : revision);
      const restoredRevision = [...validation.revisions].reverse().find((revision) => revision.status === 'accepted' && revision.after_url === selected.before_url) || null;
      validation.active_revision_id = restoredRevision?.id || null;
      validation.continuity_review_required = Boolean(restoredRevision);
      await db.updateScene(target.id, { asset_url: selected.before_url, keyframe_url: selected.before_keyframe_url || null, validation });
      Object.assign(target, { asset_url: selected.before_url, keyframe_url: selected.before_keyframe_url || null, validation });
      setScenes((items) => items.map((item) => item.id === target.id ? { ...item, asset_url: selected.before_url, keyframe_url: selected.before_keyframe_url || null, validation } : item));
      const filmPatch: Partial<Film> = { final_video_url: null, final_thumb_url: null, status: 'producing', machine_state: allScenesDone(engineScenes.current) ? 'ALL_SCENES_COMPLETED' : f.machine_state, stage_note: `Scene ${target.idx + 1} restored to the immutable original. Reassemble when ready.`, error: null };
      await db.updateFilm(f.id, filmPatch); Object.assign(f, filmPatch); setFilm({ ...f });
    }, { block: true });
  }

  /** [Generate All Ready] — render prepared scenes sequentially so each
   * downstream request consumes the newly validated prior frame. */
  function handleGenerateAll() {
    const f = engineFilm.current;
    if (!f) return;
    void run(async () => {
      await generateAllReadyScenes(f, engineScenes.current, hooks);
      // The batch prepares nothing, so scenes that were still waiting are
      // picked back up by the sequential loop when auto-generate is on.
      autoFiredFor.current = '';
      if (autoRef.current) await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
      await maybeAdvancePost();
    }, { block: true });
  }

  /** [Style Lock] — toggled from the board mid-production. */
  const handleToggleStyleLock = (on: boolean) => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => setStyleLock(f, engineScenes.current, hooks, on));
  };

  function handleToggleAuto(on: boolean) {
    setAuto(on);
    autoRef.current = on;
    autoFiredFor.current = '';
    const f = engineFilm.current;
    if (f) writeAutoPref(f.id, on);
    if (on && f && !running.current) {
      void run(async () => {
        await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
        await maybeAdvancePost();
      });
    }
  }

  function handleToggleAutoPost(on: boolean) {
    setAutoPost(on);
    autoPostRef.current = on;
    const f = engineFilm.current;
    if (on && f && !f.plan?.background?.enabled && !running.current && allScenesDone(engineScenes.current) && f.status !== 'ready' && !audioReady(f.audio)) {
      postKickedFor.current = null;
      void run(() => maybeAdvancePost());
    }
  }

  /** Manually run ONE post-production step (Auto-complete off). */
  const handleRunLayer = (layer: 'narration' | 'music' | 'sfx') => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => runAudioLayerStep(f, engineScenes.current, hooks, layer), { block: true });
  };

  const handleRegenNarration = () => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => regenerateNarration(f, engineScenes.current, hooks), { block: true });
  };

  const handleRegenSfx = () => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => regenerateSfx(f, engineScenes.current, hooks), { block: true });
  };

  /** Plain native-audio cut — no narration/music/SFX layers. */
  async function handleNativeCut() {
    const f = engineFilm.current;
    if (!f || f.plan?.background?.enabled) return;
    await run(async () => {
      await assembleReadyFilm(f, engineScenes.current, hooks);
      setScreen('final');
    }, { block: true });
  }

  /** Plan + generate the audio layers (narration / music / SFX). */
  async function handlePrepareAudio() {
    const f = engineFilm.current;
    if (!f) return;
    await run(() => prepareFilmAudioStage(f, engineScenes.current, hooks), { block: true });
  }

  /** One-click FINAL ASSEMBLY — existing clips + narration + music + SFX →
   * FFmpeg. Never regenerates video. */
  async function handleFinalAssembly(o: { captions: boolean }) {
    const f = engineFilm.current;
    if (!f || f.plan?.background?.enabled) return;
    await run(() => runFinalAssembly(f, engineScenes.current, hooks, { captions: o.captions }), { block: true });
  }

  function handleStopFinish() {
    const f = engineFilm.current;
    if (!f) return;
    stopFinalAssembly(f.id);
    setNote('Stopping after the active step. Saved scenes and audio will resume on Retry.');
  }

  const handleRetryLayer = (layer: 'narration' | 'music' | 'sfx') => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => retryAudioLayer(f, engineScenes.current, hooks, layer), { block: true });
  };

  const handleSkipLayer = (layer: 'narration' | 'music' | 'sfx') => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => skipAudioLayer(f, engineScenes.current, hooks, layer), { block: true });
  };

  const handleChangeVoice = (voiceId: string, voiceName?: string) => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => changeNarrationVoice(f, engineScenes.current, hooks, voiceId, voiceName), { block: true });
  };

  const handleChangeMusic = (preset: string) => {
    const f = engineFilm.current;
    if (!f) return;
    void run(() => changeMusicDirection(f, engineScenes.current, hooks, preset), { block: true });
  };

  /** [Voice Source] — No Voiceover / ElevenLabs / built-in AI voice. The pick
   * is remembered for the session and only re-shapes the narration layer; it
   * never regenerates a clip and never records on its own. */
  const handleChangeVoiceSource = (source: VoiceSourceId, voice?: string) => {
    const nextVoice = voice || openaiVoice;
    setVoiceSource(source);
    saveVoiceSourcePref(source);
    if (voice) { setOpenaiVoice(voice); saveOpenAiVoicePref(voice); }
    const f = engineFilm.current;
    if (!f) return;
    void run(() => changeVoiceSource(f, engineScenes.current, hooks, source, nextVoice));
  };

  async function handlePersistAssistant(messages: AgentMessage[], metrics: AgentMetrics, trimNotice?: string) {
    const f = engineFilm.current;
    if (!f?.plan) throw new Error('Open a planned film before saving Director memory.');
    const plan = {
      ...f.plan,
      assistant: {
        messages,
        metrics,
        ...(trimNotice ? { trim_notice: trimNotice, trimNotice } : {}),
        updated_at: new Date().toISOString(),
      },
    } as typeof f.plan;
    await db.updateFilm(f.id, { plan });
    Object.assign(f, { plan });
    setFilm({ ...f });
  }

  async function handleAgentProposal(proposal: AgentProposal): Promise<{ message: string; undo?: AgentUndo }> {
    if (running.current) throw new Error('The film pipeline is busy with another step.');
    const f = engineFilm.current;
    if (!f?.plan) throw new Error('Open a planned film first.');
    const list = engineScenes.current;
    running.current = true; setBusy(true); setError('');
    try {
      if (proposal.tool === 'edit_brief') {
        if (!planCanChange()) throw new Error('The plan is locked after paid production starts.');
        const args = proposal.args as any;
        const plannedDuration = list.reduce((sum, scene) => sum + Number(scene.duration_s || 0), 0);
        if (args.target_duration_sec != null && Number(args.target_duration_sec) !== plannedDuration) {
          throw new Error(`This saved plan contains ${plannedDuration}s of legal blocks. Changing it to ${args.target_duration_sec}s requires a new planning pass; nothing was changed.`);
        }
        const before = {
          title: f.title,
          visual_direction: f.plan.custom_visual_direction,
          style_direction: f.plan.style_direction,
          audio_policy: f.plan.audio_policy,
          target_duration_sec: f.plan.target_duration_sec,
          audio_enabled: f.plan.audio_enabled,
          narration_enabled: f.plan.narration_enabled,
          characters_speak: f.plan.characters_speak,
        };
        const flags = args.audio_policy ? audioPolicyFlags(args.audio_policy) : null;
        const plan = {
          ...f.plan,
          ...(args.visual_direction ? { custom_visual_direction: args.visual_direction, style_direction: args.visual_direction } : {}),
          ...(args.audio_policy ? { audio_policy: args.audio_policy, audio_enabled: flags!.audioEnabled, narration_enabled: flags!.narrationEnabled, characters_speak: flags!.charactersSpeak } : {}),
          ...(args.target_duration_sec != null ? { target_duration_sec: args.target_duration_sec } : {}),
          scene_plan_version: Number(f.plan.scene_plan_version || 1) + 1,
        } as typeof f.plan;
        const patch: Partial<Film> = { plan, ...(args.title ? { title: args.title } : {}), status: 'plan_ready' };
        await db.updateFilm(f.id, patch); Object.assign(f, patch); setFilm({ ...f });
        return { message: 'Brief updated. The source script and rendered media were not changed.', undo: { tool: 'edit_brief', payload: before as any } };
      }

      if (proposal.tool === 'edit_character') {
        if (!planCanChange()) throw new Error('Character identity is locked after paid production starts.');
        const args = proposal.args as any;
        const current = (f.character_refs || []).find((character) => character.id === args.character_id);
        if (!current) throw new Error('That character is no longer in this film.');
        const before = { ...current, voice: { ...current.voice } };
        const next = (f.character_refs || []).map((character) => character.id !== current.id ? character : {
          ...character,
          ...(args.name ? { name: args.name } : {}), ...(args.role ? { role: args.role } : {}),
          ...(args.age_appearance ? { age_appearance: args.age_appearance } : {}), ...(args.wardrobe ? { wardrobe: args.wardrobe } : {}),
          ...(args.personality_voice ? { personality_voice: args.personality_voice } : {}), ...(args.appearance ? { appearance: args.appearance } : {}),
          voice: {
            ...character.voice,
            ...(args.voice_tone ? { tone: args.voice_tone } : {}), ...(args.voice_accent ? { accent: args.voice_accent } : {}), ...(args.voice_pace ? { pace: args.voice_pace } : {}),
          },
          approved: false,
        });
        await persistCast(next, false);
        return { message: `${current.name} updated and returned to cast review. No rendered clip changed.`, undo: { tool: 'edit_character', payload: { character: before } } };
      }

      if (proposal.tool === 'edit_scene_prompt') {
        if (!planCanChange()) throw new Error('The plan is locked after paid production starts. Regenerate only the affected scene instead.');
        const args = proposal.args as any;
        const target = list.find((scene) => scene.id === args.scene_id);
        if (!target) throw new Error('That scene is no longer in this film.');
        const before = { scene_id: target.id, prompt: target.prompt, spec: target.spec, status: target.status, error: target.error, scene_plan_version: f.plan.scene_plan_version };
        const spec = { ...(target.spec as any), ...(args.timed_beats ? { timed_beats: args.timed_beats } : {}), prompt_version: Number((target.spec as any)?.prompt_version || 1) + 1 };
        const rowPatch: Partial<FilmScene> = { prompt: args.prompt, spec, status: 'ready', error: null };
        const plan = { ...f.plan, scenes: (f.plan.scenes || []).map((scene) => scene.scene_key === target.scene_key ? { ...scene, spec } : scene), scene_plan_version: Number(f.plan.scene_plan_version || 1) + 1 } as typeof f.plan;
        await Promise.all([db.updateScene(target.id, rowPatch), db.updateFilm(f.id, { plan, status: 'plan_ready' })]);
        Object.assign(target, rowPatch); Object.assign(f, { plan, status: 'plan_ready' as const }); setScenes([...list]); setFilm({ ...f });
        return { message: `Scene ${target.idx + 1} prompt updated and ready for review.`, undo: { tool: 'edit_scene_prompt', payload: before as any } };
      }

      if (proposal.tool === 'regenerate_scene') {
        const args = proposal.args as any;
        const target = list.find((scene) => scene.id === args.scene_id);
        if (!target) throw new Error('That scene is no longer in this film.');
        if (f.plan.background?.enabled) throw new Error('Pause the durable production before regenerating one scene.');
        if (target.status === 'generating' || list.some((scene) => scene.id !== target.id && scene.status === 'generating')) throw new Error('Wait for the active provider job to finish before regenerating a scene.');
        const before = { scene_id: target.id, prompt: target.prompt, spec: target.spec, status: target.status, error: target.error, asset_url: target.asset_url, first_frame_url: target.first_frame_url, keyframe_url: target.keyframe_url, validation: target.validation, clip_fingerprint: target.clip_fingerprint, veo_operation_id: target.veo_operation_id };
        await regenerateScenePrompt(f, list, target, hooks, String(args.instruction));
        await generateScene(f, list, target, hooks);
        setScenes([...list]); setFilm({ ...f });
        return { message: `Scene ${target.idx + 1} was regenerated. Every other scene stayed untouched.`, undo: { tool: 'regenerate_scene', payload: before as any } };
      }

      if (proposal.tool === 'approve_plan') {
        if (!planCanChange()) throw new Error('This plan is already locked by production.');
        const before = { orchestration: f.plan.orchestration };
        const plan = { ...f.plan, orchestration: { ...(f.plan.orchestration || { manual_locks: {}, completed_count: 0, total_count: list.length, credits_estimated: 0, credits_reserved: 0, credits_actual: 0, billed_so_far: 0 }), state: 'queued' as const, intent: 'approve' as const, checkpoint: 'agent_approved_plan', paused: false, cancel_requested: false, updated_at: new Date().toISOString() } } as typeof f.plan;
        await db.updateFilm(f.id, { plan, status: 'plan_ready', stage_note: 'Plan approved — review the saved authorization, then Start durable production.' });
        Object.assign(f, { plan, status: 'plan_ready' as const, stage_note: 'Plan approved — review the saved authorization, then Start durable production.' }); setFilm({ ...f });
        return { message: 'Plan approved. No paid render was submitted.', undo: { tool: 'approve_plan', payload: before as any } };
      }

      if (proposal.tool === 'start_render') {
        const cast = Array.isArray(f.character_refs) ? f.character_refs : [];
        if (f.plan.cast_reviewed !== true || cast.some((character) => !character.approved || !character.url)) throw new Error(cast.length ? 'Approve every retained character sheet before Start.' : 'Confirm that this script needs no cast before Start.');
        if (requiresSignedInVideoTab(f, list)) {
          setNote('Starting signed-in production — keep this tab open while Kling or Seedance submits and polls…');
          armAuto(f.id, true); writeAutoPref(f.id, true);
          await autoProduce(f, list, hooks, () => autoRef.current);
          await maybeAdvancePost();
          return { message: allScenesDone(list)
            ? 'Signed-in production completed every scene in continuity order.'
            : 'Signed-in production paused at the next action. Keep this tab open while Kling or Seedance is rendering; completed scenes and credit receipts are saved.' };
        }
        await startUnattendedProduction(f, list, reviewRef.current, captionsRef.current);
        armAuto(f.id, false); writeAutoPref(f.id, false);
        const [fresh, freshScenes] = await Promise.all([db.getFilm(f.id), db.listScenes(f.id)]);
        if (fresh) adopt(fresh, freshScenes);
        return { message: 'Gemini Omni production started. It continues from saved checkpoints with this tab closed.' };
      }

      if (proposal.tool === 'stop_render') {
        if (!f.plan.background?.enabled || !f.plan.orchestration) throw new Error('No durable render is active.');
        const mode = String(proposal.args.mode || 'pause');
        if (mode === 'pause') {
          const plan = { ...f.plan, orchestration: { ...f.plan.orchestration, paused: true, state: 'resumable' as const, checkpoint: 'paused_after_current_job', updated_at: new Date().toISOString() } } as typeof f.plan;
          await db.updateFilm(f.id, { plan, stage_note: 'Paused — the current provider job may finish, but no future block will be submitted.' });
          Object.assign(f, { plan, stage_note: 'Paused — the current provider job may finish, but no future block will be submitted.' }); setFilm({ ...f });
          return { message: 'Future submissions paused. A provider job already submitted may still finish and be billed.' };
        }
        const plan = { ...f.plan, orchestration: { ...f.plan.orchestration, cancel_requested: true, state: 'cancelled' as const, checkpoint: 'stop_future_jobs_requested', updated_at: new Date().toISOString() } } as typeof f.plan;
        await db.updateFilm(f.id, { plan, status: 'cancelled', stage_note: 'Future jobs stopped. Completed clips remain saved; an already-submitted provider job may still settle.' });
        Object.assign(f, { plan, status: 'cancelled' as const, stage_note: 'Future jobs stopped. Completed clips remain saved; an already-submitted provider job may still settle.' }); setFilm({ ...f });
        return { message: 'Every future job was stopped. Completed clips remain saved; an already-submitted job may still settle.' };
      }
      throw new Error(`Unsupported Director action: ${proposal.tool}`);
    } finally { running.current = false; setBusy(false); }
  }

  async function handleAgentUndo(undo: AgentUndo): Promise<string> {
    if (running.current) throw new Error('The film pipeline is busy with another step.');
    const f = engineFilm.current;
    if (!f?.plan) throw new Error('Open a planned film first.');
    const payload = undo.payload as any;
    running.current = true; setBusy(true); setError('');
    try {
      if (undo.tool === 'edit_brief') {
        const plan = { ...f.plan, custom_visual_direction: payload.visual_direction, style_direction: payload.style_direction, audio_policy: payload.audio_policy, target_duration_sec: payload.target_duration_sec, audio_enabled: payload.audio_enabled, narration_enabled: payload.narration_enabled, characters_speak: payload.characters_speak } as typeof f.plan;
        await db.updateFilm(f.id, { plan, title: payload.title }); Object.assign(f, { plan, title: payload.title }); setFilm({ ...f });
        return 'Brief restored to its previous values.';
      }
      if (undo.tool === 'edit_character') {
        const previous = payload.character as FilmCharacter;
        await persistCast((f.character_refs || []).map((character) => character.id === previous.id ? previous : character), f.plan.cast_reviewed === true);
        return `${previous.name} restored.`;
      }
      if (undo.tool === 'edit_scene_prompt' || undo.tool === 'regenerate_scene') {
        const target = engineScenes.current.find((scene) => scene.id === payload.scene_id);
        if (!target) throw new Error('The original scene row is no longer available.');
        const rowPatch: Partial<FilmScene> = { prompt: payload.prompt, spec: payload.spec, status: payload.status, error: payload.error, ...(undo.tool === 'regenerate_scene' ? { asset_url: payload.asset_url, first_frame_url: payload.first_frame_url, keyframe_url: payload.keyframe_url, validation: payload.validation, clip_fingerprint: payload.clip_fingerprint, veo_operation_id: payload.veo_operation_id } : {}) };
        const plan = { ...f.plan, scenes: (f.plan.scenes || []).map((scene) => scene.scene_key === target.scene_key ? { ...scene, spec: payload.spec } : scene), ...(payload.scene_plan_version != null ? { scene_plan_version: payload.scene_plan_version } : {}) } as typeof f.plan;
        await Promise.all([db.updateScene(target.id, rowPatch), db.updateFilm(f.id, { plan })]); Object.assign(target, rowPatch); Object.assign(f, { plan }); setScenes([...engineScenes.current]); setFilm({ ...f });
        return `Scene ${target.idx + 1} restored to its previous saved version. Provider charges, if any, cannot be reversed.`;
      }
      if (undo.tool === 'approve_plan') {
        const plan = { ...f.plan, orchestration: payload.orchestration } as typeof f.plan;
        await db.updateFilm(f.id, { plan }); Object.assign(f, { plan }); setFilm({ ...f });
        return 'Plan approval restored to its previous state.';
      }
      throw new Error('This action cannot be undone safely.');
    } finally { running.current = false; setBusy(false); }
  }

  async function handleAudioProbe(scene: FilmScene, probe: ClipAudioProbe) {
    const target = engineScenes.current.find((item) => item.id === scene.id);
    if (!target) return;
    const measured = { ...probe, rmsDb: Number.isFinite(probe.rmsDb) ? probe.rmsDb : null, peakDb: Number.isFinite(probe.peakDb) ? probe.peakDb : null, measured_at: new Date().toISOString() };
    const previous = (target.validation as any)?.audio_probe;
    if (previous && previous.audible === measured.audible && previous.rmsDb === measured.rmsDb && previous.peakDb === measured.peakDb && previous.channels === measured.channels && previous.sampleRate === measured.sampleRate) return;
    const validation = { ...(target.validation || {}), audio_probe: measured };
    try {
      await db.updateScene(target.id, { validation }); Object.assign(target, { validation }); setScenes([...engineScenes.current]);
    } catch (caught: any) {
      setError(`The clip sound check completed, but its evidence could not be saved: ${String(caught?.message || caught)}`);
    }
  }
  async function openFilm(f: Film) {
    setError(''); setNote(''); setAssembly(null);
    advancedFor.current = null; postKickedFor.current = null;
    assembleKickedFor.current = null;
    stallRetriedScenes.current = new Set();
    frameRecoveryFor.current = null;
    stateSince.current = { id: 0, state: '', at: 0 };
    // Finishing never waits for an approval gate. Stop is the only interrupt.
    reviewRef.current = false;
    // Auto-generate is the film's own remembered setting, never a fresh false:
    // a half-produced film reopened with it on resumes at PROMPT_READY instead
    // of waiting for a click.
    armAuto(f.id);
    try {
      const list = await db.listScenes(f.id);
      // Browser-side FFmpeg has no background job to resume after a reload. A
      // row left in FFMPEG_ASSEMBLY with no final URL is therefore interrupted,
      // not actively rendering. Reset it before adopt() so the Final screen
      // does not permanently disable Retry Assembly behind status=assembling.
      const interruptedAssembly = f.plan?.background?.enabled !== true
        && f.status === 'assembling'
        && f.machine_state === 'FFMPEG_ASSEMBLY'
        && !f.final_video_url;
      if (interruptedAssembly) {
        const recovery: Partial<Film> = {
          status: 'producing',
          machine_state: audioReady(f.audio) ? 'AUDIO_READY' : 'ALL_SCENES_COMPLETED',
          stage_note: 'The previous assembly was interrupted — resuming from the saved scenes and audio.',
          error: null,
        };
        await db.updateFilm(f.id, recovery);
        Object.assign(f, recovery);
      }
      try { await settlePendingBackgroundRefunds(f); }
      catch (refundError: any) { setError(String(refundError?.message || refundError)); }
      adopt(f, list);
      const scenesDone = allScenesDone(list);
      if (f.status === 'ready' && f.final_video_url) { setScreen('final'); advancedFor.current = f.id; }
      else if (scenesDone) {
        // Scenes are complete — land directly in post-production, and resume
        // an interrupted final assembly or the audio pipeline automatically.
        setScreen('final');
        advancedFor.current = f.id;
        if (!f.plan?.background?.enabled && interruptedAssembly && audioReady(f.audio) && !running.current) {
          void run(() => runFinalAssembly(engineFilm.current!, engineScenes.current, hooks, { captions }), { block: true });
        } else if (!f.plan?.background?.enabled && autoPostRef.current && !audioReady(f.audio) && !f.error && !running.current) {
          postKickedFor.current = f.id;
          void run(() => autoPostProduce(engineFilm.current!, engineScenes.current, hooks));
        }
      } else setScreen('board');
      // In-flight work is resumed by the server sweeper. Reopening this screen
      // only adopts persisted rows; it never submits, polls, renders or assembles.
    } catch (e: any) { setError(String(e?.message || e)); }
  }

  /** Archive / unarchive a film from the Library (soft hide, keeps the row). */
  async function handleArchiveFilm(f: Film, archived: boolean) {
    setFilms((prev) => prev.map((x) => (x.id === f.id ? { ...x, is_archived: archived } : x)));
    try {
      await db.setFilmArchived(f.id, archived);
    } catch (e: any) {
      setError(String(e?.message || e));
      await loadLibrary();
    }
  }

  /** Permanently delete a film from the Library (confirmed in Library UI). */
  async function handleDeleteFilm(f: Film) {
    const prev = films;
    setFilms((list) => list.filter((x) => x.id !== f.id));
    try {
      await db.deleteFilm(f.id);
    } catch (e: any) {
      setError(String(e?.message || e));
      setFilms(prev);
    }
  }

  // ------- render -------

  const showBack = screen !== 'library';
  const showDirector = ['board', 'final'].includes(screen) && scenes.length > 0;


  return (
    <AppShell
      title="Script-to-Video"
      header={false}
      watermark={false}
      scroll={false}
      maxWidth="full"
      padding={0}
      style={{ background: CANVAS_GRADIENT }}
    >
    <div className="s2v-app" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', background: 'transparent', fontFamily: T.sans, overflow: 'hidden' }}>
      <style>{APP_CSS}</style>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.raised}`, flexShrink: 0 }}>
        <ProductSuiteHeader
          name="Script-to-Video"
          voice="I read your whole script, protect continuity, and direct the film one verified clip at a time."
          working={busy || Boolean(note)}
          showIcon={false}
          actions={(
            <>
              {scenes.length ? <button type="button" aria-expanded={jobsOpen} onClick={() => setJobsOpen((value) => !value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: jobsOpen ? T.raised : 'transparent', border: `1px solid ${scenes.some((scene) => scene.status === 'failed') ? T.fault : T.dim}`, color: T.bone, borderRadius: 9, padding: '8px 11px', fontSize: 12, fontWeight: 750 }}><AlertCircle size={14} color={scenes.some((scene) => scene.status === 'failed') ? T.fault : T.live} />Jobs · {scenes.length}</button> : null}
              {showBack ? (
                <button className="s2v-ghost" onClick={() => { setScreen('library'); setLegacyOpen(null); setAuto(false); autoRef.current = false; setJobsOpen(false); loadLibrary(); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1px solid ${T.dim}`, color: T.muted, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '7px 11px', borderRadius: 9 }}>
                  <ArrowLeft size={14} /> Library
                </button>
              ) : null}
            </>
          )}
        />
      </div>

      {jobsOpen && scenes.length ? <section aria-label="Film jobs" style={{ flexShrink: 0, maxHeight: 320, overflowY: 'auto', background: T.raised, borderBottom: `1px solid ${T.line}`, padding: '10px 20px' }}><div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 6 }}>{[...scenes].sort((a, b) => a.idx - b.idx).map((scene) => <div key={scene.id} style={{ minHeight: 44, display: 'grid', gridTemplateColumns: '72px 110px minmax(0,1fr)', gap: 8, alignItems: 'center', color: T.muted, fontSize: 11.5 }}><span style={{ color: T.bone, fontFamily: T.mono }}>Scene {scene.idx + 1}</span><span style={{ color: scene.status === 'failed' ? T.fault : scene.status === 'completed' ? T.done : T.live, textTransform: 'capitalize' }}>{String(scene.status || 'waiting').replace(/_/g, ' ')}</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{scene.error ? friendlyAppError(scene.error) : scene.asset_url ? 'Clip saved.' : scene.prompt ? 'Prompt ready.' : 'Waiting for its turn.'}</span></div>)}{adminDiagnoses.length ? <details style={{ marginTop: 6, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}><summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', color: T.live, cursor: 'pointer', fontSize: 11.5, fontWeight: 800 }}>Founder diagnostics across users · {adminDiagnoses.length}</summary><div style={{ display: 'grid', gap: 7 }}>{adminDiagnoses.map((item) => <div key={item.id} style={{ background: T.canvas, border: `1px solid ${T.line}`, borderRadius: 8, padding: 9, color: T.muted, fontSize: 10.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}><b style={{ color: T.bone }}>{item.diagnosis?.category || 'unknown'} · {item.provider_model || 'unknown model'}</b><br />User/job: {item.user_session_id || 'unknown'} / {item.operation_id || item.id}<br />Raw provider error: {item.diagnosis?.raw_provider_error || 'not recorded'}<br />Next debug step: {item.diagnosis?.next_debug_step || 'Inspect provider request evidence.'}</div>)}</div></details> : null}</div></section> : null}

      {error ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(153,27,27,0.1)', borderBottom: '1px solid rgba(153,27,27,0.4)', color: T.fault, fontSize: 12.5, lineHeight: 1.5, padding: '9px 20px' }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{friendlyAppError(error)}</span>
        </div>
      ) : null}

      {screen === 'library' ? (
        <Library
          films={films}
          legacy={legacy}
          loading={libLoading}
          onNew={() => { setQuickText(''); setScreen('create'); }}
          onOpen={openFilm}
          onOpenLegacy={(l) => { setLegacyOpen(l); setScreen('legacy'); }}
          onQuickCreate={(t) => { setQuickText(t); setScreen('create'); }}
          onArchive={handleArchiveFilm}
          onDelete={handleDeleteFilm}
        />
      ) : null}

      {screen === 'create' ? <Suspense fallback={<div className="s2v-screen-skeleton" aria-label="Loading the creation studio"><span /></div>}><CreateScreen initialText={quickText} initialIntake={handoffIntake || undefined} initialShotUrl={handoffAttachment?.type.startsWith('image/') ? handoffAttachment.url : (typeof handoffIntake?.brandKit?.logoUrl === 'string' ? handoffIntake.brandKit.logoUrl : undefined)} initialShotName={handoffAttachment?.name || (handoffIntake ? `${String(handoffIntake.brandKit?.name || 'Brand')} logo` : undefined)} busy={busy} onSubmit={handleCreate} /></Suspense> : null}

      {screen === 'board' && film ? (
        <Suspense fallback={<div className="s2v-screen-skeleton" aria-label="Loading the production board"><span /></div>}><RenderRoom
          film={film}
          scenes={scenes}
          note={note}
          busy={busy}
          auto={auto}
          autoPost={autoPost}
          onToggleAuto={handleToggleAuto}
          onToggleAutoPost={handleToggleAutoPost}
          onStartBackground={handleStartBackground}
          onFixAudioModels={handleFixAudioModels}
          onPauseBackground={handlePauseBackground}
          onStopFutureJobs={handleStopFutureJobs}
          onGenerate={handleGenerate}
          onPrepare={handlePrepare}
          onRetry={handleRetry}
          onRetryFrame={handleRetryFrame}
          onContinueWithoutFrame={handleContinueWithoutFrame}
          onRegenPrompt={handleRegenPrompt}
          onRedo={handleRedo}
          redoingId={redoingId}
          editingId={editingId}
          onOmniEdit={handleOmniEdit}
          onAcceptRevision={handleAcceptRevision}
          onUndoRevision={handleUndoRevision}
          onSkip={handleSkip}
          onGenerateCharacterDialogue={handleCharacterDialogueFallback}
          dialogueAudioSceneId={dialogueAudioSceneId}
          onGenerateAll={handleGenerateAll}
          onToggleStyleLock={handleToggleStyleLock}
          onUpdateCharacter={handleUpdateCharacter}
          onAddCharacter={handleAddCharacter}
          onRemoveCharacter={handleRemoveCharacter}
          onRegenerateCharacter={handleRegenerateCharacter}
          onGenerateMissingCast={handleGenerateMissingCast}
          onUploadCharacter={handleUploadCharacter}
          onReuseCharacter={handleReuseCharacter}
          onConfirmEmptyCast={handleConfirmEmptyCast}
          onUpdatePlanScene={handleUpdatePlanScene}
          onGenerateStoryboard={handleGenerateStoryboard}
          onApproveStoryboard={handleApproveStoryboard}
          onMovePlanScene={handleMovePlanScene}
          onAddPlanScene={handleAddPlanScene}
          onDeletePlanScene={handleDeletePlanScene}
          onAudioProbe={handleAudioProbe}
        /></Suspense>
      ) : null}

      {screen === 'final' && film ? (
        <Suspense fallback={<div className="s2v-screen-skeleton" aria-label="Loading post-production"><span /></div>}><FinalScreen
          film={film}
          scenes={scenes}
          busy={busy}
          assembly={assembly}
          captions={captions}
          onCaptions={setCaptions}
          onBackToBoard={() => setScreen('board')}
          onPrepareAudio={handlePrepareAudio}
          onFinalAssembly={handleFinalAssembly}
          onRunLayer={handleRunLayer}
          onRegenNarration={handleRegenNarration}
          onRegenSfx={handleRegenSfx}
          onRetryLayer={handleRetryLayer}
          onSkipLayer={handleSkipLayer}
          onChangeVoice={handleChangeVoice}
          onChangeMusic={handleChangeMusic}
          onNativeCut={handleNativeCut}
          voiceSource={voiceSource}
          openaiVoice={openaiVoice}
          elevenLabsOffered={elevenOffered}
          onChangeVoiceSource={handleChangeVoiceSource}
        /></Suspense>
      ) : null}

      {screen === 'legacy' && legacyOpen ? <LegacyViewer legacy={legacyOpen} /> : null}

      {showDirector && film ? <Suspense fallback={null}><AgentPanel film={film} scenes={scenes} busy={busy} onExecute={handleAgentProposal} onUndo={handleAgentUndo} onPersist={handlePersistAssistant} /></Suspense> : null}

      {/* Persistent Final Assembly bar — in normal document flow BELOW the
          chat input, so neither can ever cover the other on any viewport. */}
      {(screen === 'board' || screen === 'final') && film && scenes.length ? (
        <Suspense fallback={null}><AssemblyBar
          film={film}
          scenes={scenes}
          assembly={assembly}
          busy={busy}
          screen={screen}
          onStop={handleStopFinish}
          onFinalAssembly={() => { setScreen('final'); void handleFinalAssembly({ captions }); }}
          onPrepareAudio={handlePrepareAudio}
          onOpenFinal={() => setScreen('final')}
          onOpenBoard={() => setScreen('board')}
        /></Suspense>
      ) : null}

      {screen === 'library' ? (
        <div style={{ flexShrink: 0, overflowY: 'auto', padding: '0 20px 20px' }}>
          <div style={{ marginTop: 4 }}>
            
          </div>
        </div>
      ) : null}
    </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Legacy playback (retired pipeline's finished films stay watchable)
// ---------------------------------------------------------------------------

function LegacyViewer({ legacy: item }: { legacy: LegacyFilm }) {
  const finalUrl = typeof item?.final_url === 'string' ? item.final_url : '';
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ color: T.bone, fontSize: 19, fontWeight: 700 }}>{item?.title || 'Legacy video'}</div>
        <div style={{ color: T.muted, fontSize: 12.5, marginTop: 4 }}>A project from the previous Script-to-Video pipeline — still fully accessible.</div>
        {finalUrl ? (
          <div style={{ marginTop: 16 }}>
            <ProbedVideo src={finalUrl} capabilityKnown={false} videoProps={{ controls: true, style: { maxWidth: '100%', maxHeight: 440, borderRadius: 12, background: '#000' } }} />
            <div style={{ marginTop: 12 }}>
              <a className="s2v-lift" href={finalUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: CTA_GRADIENT, color: ON_ACCENT, borderRadius: 10, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none', boxShadow: '0 0 24px color-mix(in srgb, var(--space-brand-primary-500) 28%, transparent)', transition: 'transform 0.18s ease, box-shadow 0.18s ease' }}>
                <Download size={14} /> Download MP4
              </a>
            </div>
          </div>
        ) : (
          <div style={{ color: T.dim, fontSize: 13, marginTop: 20 }}>This legacy project has no stored video file.</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crash containment
// ---------------------------------------------------------------------------

class S2VBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('[ScriptToVideo] crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ width: '100%', height: '100%', minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: CANVAS_GRADIENT, fontFamily: T.sans }}>
          <div style={{ maxWidth: 460, textAlign: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 16, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.48)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(153,27,27,0.1)', border: '1px solid rgba(153,27,27,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <AlertCircle size={24} color={T.fault} />
            </div>
            <div style={{ color: T.bone, fontSize: 16.5, fontWeight: 700, letterSpacing: -0.2, marginBottom: 8 }}>This screen hit a snag</div>
            <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Your film's progress is saved after every step — reopen it from the library and it picks up where it left off.
            </div>
            <button onClick={() => this.setState({ error: null })} style={{ background: CTA_GRADIENT, color: ON_ACCENT, border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
              Back to your films
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const BrandedScriptToVideo = withBrandContext(App, 'Script-to-Video');
export default BrandedScriptToVideo;
function App() {
  return (
    <S2VBoundary>
      <ScriptToVideoApp />
    </S2VBoundary>
  );
}
