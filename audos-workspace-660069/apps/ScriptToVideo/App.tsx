/**
 * Script-to-Video — sequential AI clip pipeline (Sep 2026 rebuild).
 *
 *   Script → Opus 5 reads the WHOLE story → sequential clip plan (4/6/8/10s)
 *          → one prompt at a time (global + scene + continuity context)
 *          → generation on the Google video model (Omni Flash), fired by
 *            auto-generate the moment a prompt is ready — or by a click
 *          → FFmpeg extracts + validates each clip's real final frame
 *          → Opus decides continuation vs. independent scene for the next clip
 *          → FFmpeg assembles the final film
 *
 * Prompt preparation and generation are SEPARATE operations; dependent clips
 * are never generated simultaneously; a failed scene never loses completed
 * ones. State persists to WorkspaceDB after every step — reopening a film
 * resumes in-flight renders. Screens: Library · Create · Board · Final · Legacy.
 */
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Download, Sparkles } from 'lucide-react';
import { Film, FilmScene, T, db } from './api';
import {
  AssemblyProgress, activeScene, allScenesDone, assembleReadyFilm,
  autoPostProduce, autoProduce, changeMusicDirection, changeNarrationVoice,
  changeVoiceSource, createAndSegmentFilm, createManualScriptFilm, generateScene,
  isFrameExtractionStalled, msSinceFilmUpdate, prepareFilmAudioStage, prepareScene,
  recoverStalledFrameExtraction, regenerateNarration, regenerateScenePrompt,
  regenerateSfx, resumeFilm, retryAudioLayer, retryScene, runAudioLayerStep,
  runFinalAssembly, skipAudioLayer, skipScene, useCharacterReferenceFallback,
} from './pipeline/orchestrator';
import { audioReady } from './pipeline/audio';
import {
  DEFAULT_OPENAI_VOICE, elevenLabsOffered, loadOpenAiVoicePref, loadVoiceSourcePref,
  saveOpenAiVoicePref, saveVoiceSourcePref, subscribeElevenLabs,
  syncElevenLabsAvailability,
} from './pipeline/voiceSource';
import type { VoiceSourceId } from './pipeline/voiceSource';
import { LB_SHIMMER_CSS } from '../../components/LightBeam';
import ProductSuiteHeader from '../../components/ProductSuiteHeader';
import Library, { LegacyFilm } from './Library';
import { CreateScreen } from './CreateFlow';
import type { CreateMode } from './CreateFlow';
import RenderRoom from './RenderRoom';
import { FinalScreen } from './ReviewFinish';
import AgentPanel from './AgentPanel';
import AssemblyBar from './AssemblyBar';
import AgentStudio from './ModelTester';
import { AgentChatProvider } from '../../components/AgentChat/AgentChatContext';
import { AgentChatButton } from '../../components/AgentChat/AgentChatButton';
import { AgentChatPanel } from '../../components/AgentChat/AgentChatPanel';
import { videoEngine } from '../../lib/videoEngines';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import type { VidvergeAttachment } from '../../lib/vidvergeHandoff';
import { saveVideoSelection } from '../../lib/videoIntegrations';

type Screen = 'library' | 'create' | 'board' | 'final' | 'legacy' | 'tester';

function friendlyAppError(value: unknown): string {
  const raw = String(value || 'This step could not be completed.');
  const named = raw.replace(/(?:openrouter\/[^\s,;]+|gemini-omni-flash-preview|veo-[\w.-]+)/g, (id) => videoEngine(id)?.label || 'the selected video engine');
  if (/no_credentials|\b401\b/i.test(named)) return 'Your workspace session is not ready yet. Try again in a moment.';
  if (/insufficient|payment|required|\b402\b/i.test(named)) return 'This generation needs more workspace credits before it can start.';
  if (/rate.?limit|\b429\b/i.test(named)) return 'The video service is busy right now. Wait a moment, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(named)) return 'The video service is temporarily unavailable. Your film is saved; retry this step shortly.';
  return named;
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
    return stored === null ? true : stored === '1';
  } catch { return true; }
}

function writeAutoPref(filmId: number, on: boolean) {
  try { window.localStorage.setItem(autoPrefKey(filmId), on ? '1' : '0'); } catch { /* preference only */ }
}

const APP_CSS = `
  .s2v-app button { transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; }
  .s2v-app button:focus-visible, .s2v-app a:focus-visible { outline: 2px solid ${T.live}; outline-offset: 2px; }
  .s2v-app input:focus-visible, .s2v-app textarea:focus-visible, .s2v-app select:focus-visible { outline: none; border-color: ${T.live} !important; box-shadow: 0 0 0 3px rgba(245,158,11,0.18); }
  ${LB_SHIMMER_CSS}
  .s2v-app input, .s2v-app textarea, .s2v-app select { transition: border-color 0.18s ease, box-shadow 0.18s ease; }
  .s2v-row { transition: background-color 0.16s ease; border-radius: 10px; }
  .s2v-row:hover { background: rgba(255,255,255,0.035) !important; }
  .s2v-lift:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
  .s2v-lift:active:not(:disabled) { transform: translateY(0); }
  .s2v-ghost:hover:not(:disabled) { color: ${T.bone} !important; background: rgba(255,255,255,0.05) !important; }
  .s2v-app ::-webkit-scrollbar { width: 8px; height: 8px; }
  .s2v-app ::-webkit-scrollbar-thumb { background: ${T.dim}; border-radius: 999px; }
  .s2v-app ::-webkit-scrollbar-track { background: transparent; }
  @media (prefers-reduced-motion: reduce) {
    .s2v-app *, .s2v-app *::before, .s2v-app *::after { transition-duration: 0.01ms !important; }
    .s2v-app .animate-spin, .s2v-app .lb-shimmer { animation: none !important; }
  }
`;

/** The studio canvas. A flat fill read cheap next to the rest of the suite, so
 * the shell sits on a subtle navy-to-violet gradient instead. */
const CANVAS_GRADIENT = 'linear-gradient(160deg, #0d0d1a, #1a1033)';

/** The amber LightBeam CTA, as a gradient rather than one flat swatch. */
const CTA_GRADIENT = 'linear-gradient(90deg, #f59e0b, #d97706)';

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

  // The orchestrator works on MUTABLE engine objects (the state machine folds
  // continuity from clip to clip); React state mirrors them through the hooks.
  const engineFilm = useRef<Film | null>(null);
  const engineScenes = useRef<FilmScene[]>([]);
  const running = useRef(false);
  const autoRef = useRef(false);
  const autoPostRef = useRef(true);
  // One-shot guards per film: the auto-advance to post-production and the
  // audio auto-run each fire once per opened film — never in a loop.
  const advancedFor = useRef<number | null>(null);
  const postKickedFor = useRef<number | null>(null);
  // Auto-generate fires once per PROMPT_READY scene: the key is film + scene,
  // so every newly prepared clip re-arms the trigger while a scene already
  // handed to the engine never fires twice.
  const autoFiredFor = useRef('');
  // One-shot guard for the stalled frame-extraction recovery, per film.
  const frameRecoveryFor = useRef<number | null>(null);
  // When the film entered its current machine_state, so a stall is measured
  // from the transition rather than from when this tab happened to open it.
  const stateSince = useRef<{ id: number; state: string; at: number }>({ id: 0, state: '', at: 0 });

  const hooks = useRef({
    onFilm: (patch: Partial<Film>) => setFilm((f) => (f ? { ...f, ...patch } : f)),
    onScene: (id: number, patch: Partial<FilmScene>) => setScenes((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    onNote: (n: string) => setNote(n),
    onAssembly: (p: AssemblyProgress) => setAssembly(p),
  }).current;

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    try {
      setFilms(await db.listFilms());
      setError('');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLibLoading(false);
    }
    // Legacy projects (retired s2v-run pipeline) — read-only, best-effort.
    try {
      const wdb = (window as any).__workspaceDb;
      if (wdb) {
        const { data } = await wdb.from('s2v_projects').orderBy('created_at', 'desc').limit(50).get();
        const rows = (Array.isArray(data) ? data : [])
          .filter((r: any) => r && (r.final_url || r.assembled_url))
          .map((r: any) => ({ id: Number(r.id), title: String(r.title || 'Legacy video'), final_url: String(r.final_url || r.assembled_url || ''), created_at: String(r.created_at || '') }));
        setLegacy(rows);
      }
    } catch { setLegacy([]); }
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

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
    const referenceLine = attachment && !attachment.type.startsWith('image/') ? `\n\nReference asset (${attachment.name}): ${attachment.url}` : '';
    setQuickText(`${String(handoff.prompt || '').trim()}${referenceLine}`.trim());
    setHandoffAttachment(attachment);
    if (handoff.videoIntegration && handoff.videoModel) {
      saveVideoSelection(handoff.videoIntegration as any, handoff.videoModel);
      try {
        window.sessionStorage.setItem('s2v:videoModel', handoff.videoModel);
        window.sessionStorage.setItem('s2v:modelMode', 'manual');
      } catch { /* preference only */ }
    }
    setScreen('create');
  }, []);

  /** Set auto-generate for a film and re-arm the PROMPT_READY trigger. */
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
  useEffect(() => {
    if (!film || (screen !== 'board' && screen !== 'final')) return;
    const filmId = film.id;
    const tick = () => {
      if (!autoRef.current || running.current) return;
      const f = engineFilm.current;
      if (!f || f.id !== filmId || f.status === 'ready') return;
      // The scene row is the authority for PROMPT_READY: a prepared prompt
      // sitting on 'ready' is exactly what that state means.
      const head = activeScene(engineScenes.current);
      if (!head || head.status !== 'ready' || !head.prompt) return;
      const key = `${f.id}:${head.id}`;
      if (autoFiredFor.current === key) return;
      autoFiredFor.current = key;
      void run(async () => {
        await autoProduce(f, engineScenes.current, hooks, () => autoRef.current);
        await maybeAdvancePost();
      });
    };
    tick();
    const timer = window.setInterval(tick, 4000);
    return () => window.clearInterval(timer);
  }, [film?.id, screen]);

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

  // EXTRACTING_FINAL_FRAME WATCHDOG — the clip has already rendered and been
  // stored by the time a film reaches this state, so sitting in it is never
  // progress. Past the stall budget the frame stage is retried from the stored
  // clip (never a re-render) and, failing that, the scene completes without a
  // keyframe and the next one opens with no reference. One attempt per film.
  useEffect(() => {
    if (!film || film.machine_state !== 'EXTRACTING_FINAL_FRAME') return;
    const filmId = film.id;
    const tick = () => {
      if (running.current || busy) return;
      if (frameRecoveryFor.current === filmId) return;
      const f = engineFilm.current;
      if (!f || f.id !== filmId) return;
      const since = stateSince.current.id === filmId && stateSince.current.state === 'EXTRACTING_FINAL_FRAME'
        ? Math.max(0, Date.now() - stateSince.current.at)
        : msSinceFilmUpdate(f);
      if (!isFrameExtractionStalled(f, engineScenes.current, since)) return;
      frameRecoveryFor.current = filmId;
      void run(async () => {
        await recoverStalledFrameExtraction(f, engineScenes.current, hooks);
        await maybeAdvancePost();
      });
    };
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, [film?.id, film?.machine_state, busy]);

  function adopt(f: Film, list: FilmScene[]) {
    engineFilm.current = f;
    engineScenes.current = list;
    setFilm({ ...f });
    setScenes(list.map((s) => ({ ...s })));
    // A film that already has an audio plan carries its own voice-source
    // decision: the selector shows THAT, not whatever was last picked here.
    // An older plan predates the choice, so it is ElevenLabs by definition —
    // reopening one must not silently drop narration it already recorded.
    const stored: VoiceSourceId | null = f.audio ? (f.audio.voice_source || 'elevenlabs') : null;
    if (stored) { setVoiceSource(stored); saveVoiceSourcePref(stored); }
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

  /** AUTO-ADVANCE — when the LAST scene completes (11/11 ✓ + continuity ✓),
   * move to the post-production view and, when Auto-complete post-production
   * is on, run narration → music → SFX automatically until Ready for Final
   * Assembly. Called inside run(), so the single-flight guard is held. */
  async function maybeAdvancePost() {
    const f = engineFilm.current;
    if (!f || !allScenesDone(engineScenes.current)) return;
    if (advancedFor.current !== f.id) {
      advancedFor.current = f.id;
      if (f.status !== 'ready') setScreen('final');
    }
    if (autoPostRef.current && postKickedFor.current !== f.id && f.status !== 'ready' && !audioReady(f.audio)) {
      postKickedFor.current = f.id;
      await autoPostProduce(f, engineScenes.current, hooks);
    }
  }

  // ------- flow handlers -------

  async function handleCreate(params: { mode?: CreateMode; script: string; aspect: any; screenshotUrl: string | null; characterRefUrl?: string | null; note: string; videoModel?: string }) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      // Manual Script Mode skips scene detection and the directing pass
      // entirely: the pasted script already says what every clip is.
      const res = params.mode === 'manual'
        ? await createManualScriptFilm({ script: params.script, aspect: params.aspect, characterRefUrl: params.characterRefUrl || null, referenceImageUrl: params.screenshotUrl, note: params.note, videoModel: params.videoModel }, hooks)
        : await createAndSegmentFilm({ script: params.script, aspect: params.aspect, referenceImageUrl: params.screenshotUrl, characterRefUrl: params.characterRefUrl || null, note: params.note, videoModel: params.videoModel }, hooks);
      const freshScenes = await db.listScenes(res.film.id);
      adopt(res.film, freshScenes);
      advancedFor.current = null; postKickedFor.current = null;
      frameRecoveryFor.current = null;
      stateSince.current = { id: 0, state: '', at: 0 };
      armAuto(res.film.id);
      setScreen('board');
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { running.current = false; setBusy(false); }
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
  const handleUseCharRef = withEngine((f, list, s) => useCharacterReferenceFallback(f, list, s, hooks));
  const handleSkip = withEngine((f, list, s) => skipScene(f, list, s, hooks));

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
    if (on && f && !running.current && allScenesDone(engineScenes.current) && f.status !== 'ready' && !audioReady(f.audio)) {
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
    if (!f) return;
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
    if (!f) return;
    await run(() => runFinalAssembly(f, engineScenes.current, hooks, { captions: o.captions }), { block: true });
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

  async function handleDirect(scene: FilmScene, instruction: string): Promise<string> {
    const f = engineFilm.current;
    const engineScene = engineScenes.current.find((s) => s.id === scene.id);
    if (!f || !engineScene) throw new Error('Open a film first.');
    if (running.current) throw new Error('The pipeline is busy — wait for the current step to finish.');
    running.current = true;
    try {
      await regenerateScenePrompt(f, engineScenes.current, engineScene, hooks, instruction);
      return autoRef.current
        ? `Scene ${engineScene.idx + 1} has a new prompt — auto-generate picks it up and starts the render.`
        : `Scene ${engineScene.idx + 1} has a new prompt — review it and generate when ready.`;
    } finally {
      running.current = false;
    }
  }

  async function openFilm(f: Film) {
    setError(''); setNote(''); setAssembly(null);
    advancedFor.current = null; postKickedFor.current = null;
    frameRecoveryFor.current = null;
    stateSince.current = { id: 0, state: '', at: 0 };
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
      const interruptedAssembly = f.status === 'assembling'
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
      adopt(f, list);
      const scenesDone = allScenesDone(list);
      if (f.status === 'ready' && f.final_video_url) { setScreen('final'); advancedFor.current = f.id; }
      else if (scenesDone) {
        // Scenes are complete — land directly in post-production, and resume
        // an interrupted final assembly or the audio pipeline automatically.
        setScreen('final');
        advancedFor.current = f.id;
        if (interruptedAssembly && audioReady(f.audio) && !running.current) {
          void run(() => runFinalAssembly(engineFilm.current!, engineScenes.current, hooks, { captions }), { block: true });
        } else if (autoPostRef.current && !audioReady(f.audio) && !f.error && !running.current) {
          postKickedFor.current = f.id;
          void run(() => autoPostProduce(engineFilm.current!, engineScenes.current, hooks));
        }
      } else setScreen('board');
      // Adopt in-flight renders and re-arm the pipeline head (prompt prep only
      // — generation itself starts from the auto-generate trigger or a click).
      if (list.length && !running.current) {
        const needsResume = list.some((s) => s.status === 'generating') || list.some((s) => s.status === 'waiting');
        if (needsResume && f.status !== 'ready') {
          void run(async () => {
            await resumeFilm(engineFilm.current!, engineScenes.current, hooks);
            await maybeAdvancePost();
          });
        }
      }
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

  // Vidverge Agent — the floating orb assistant. It can write or improve the
  // script, open the create screen prefilled, and start the film pipeline.
  const agentContext = {
    appId: 'script-to-video',
    appName: 'Script-to-Video',
    currentInputs: {
      screen,
      scriptDraft: quickText.slice(0, 2000),
      openFilm: film ? `film #${film.id} (status: ${film.status})` : 'none',
    },
    onFillField: (field: string, value: string) => {
      if (field === 'script') { setQuickText(value); setScreen('create'); }
    },
    onTriggerAction: (action: string, params?: Record<string, unknown>) => {
      const p = params || {};
      if (action === 'generate' || action === 'create') {
        const script = (typeof p.script === 'string' && p.script.trim()) ? p.script.trim() : quickText.trim();
        if (!script) { setError('Write or fill a script first — then I can start the film.'); return; }
        const aspect = p.aspect === '9:16' ? '9:16' : '16:9';
        void handleCreate({ script, aspect, screenshotUrl: null, note: '' });
      } else if (action === 'assemble') void handleFinalAssembly({ captions });
      else if (action === 'nativeCut') void handleNativeCut();
      else if (action === 'studio') { setScreen('tester'); setAuto(false); autoRef.current = false; }
    },
    promptHint: [
      'The user writes a script and this app turns it into a film, one verified AI clip at a time.',
      'The create screen has TWO input modes. AI Mode (the default) hands the brief to the director, which reads the whole story and splits it into clips. MANUAL SCRIPT MODE is for a script the user has ALREADY broken into scenes ("Scene 1 — Title | 8 sec", then Visual:, Dialogue — Name:, Camera:): nothing re-reads or re-plans it, every scene is filmed exactly as written, and the button reads "Generate All Scenes". Point the user there when they say their script is already formatted or scene-by-scene. Either mode accepts a character reference image, which is sent with every clip alongside the previous clip’s final frame so one character carries through the film.',
      'This app also has an AGENT STUDIO: one prompt, one clip, on any Runway model (Gen 4.5 by default), with a download button. It creates no film project. Send the user there when they want a single shot rather than a whole film, or want to compare models.',
      'VOICEOVER IS OPTIONAL and never blocks the pipeline. On the final Audio & Assembly screen the VOICEOVER card leads with a Voice source choice: "No Voiceover" (the default — the clips keep their own sound), "ElevenLabs" (one premium voice, offered only when the platform voice catalog answers) and "Built-in AI Voice" (the platform’s own text-to-speech with six voices: alloy, echo, fable, onyx, nova, shimmer). If narration ever fails, the same card offers "Continue Without Voiceover" — music, SFX, scene assembly and the MP4 download all work on every setting. Never tell a user they must connect ElevenLabs to finish a film.',
      'Fields you can fill: script (the full video script — filling it opens the create screen prefilled with your text).',
      'Actions you can trigger: generate with {"script":"...","aspect":"16:9"|"9:16"} (starts scene planning and production — include the script in the params), studio (opens the Agent Studio so the user can generate one clip from one prompt), assemble (final assembly with audio layers, only when scenes are done), nativeCut (plain assembly without narration/music).',
      'When the user asks you to write or improve a script, write it yourself, then fill it with FILL_FIELD:script:… and ask if they want you to start generation.',
    ].join('\n'),
  };

  return (
    <div className="s2v-app" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', background: CANVAS_GRADIENT, fontFamily: T.sans, overflow: 'hidden' }}>
      <style>{APP_CSS}</style>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.raised}`, flexShrink: 0 }}>
        <ProductSuiteHeader
          name="Script-to-Video"
          voice={screen === 'tester'
            ? 'Agent Studio \u2014 one prompt, one clip. Pick any Runway model and I direct the render end to end.'
            : 'I read your whole script, protect continuity, and direct the film one verified clip at a time.'}
          working={busy || Boolean(note)}
          showIcon={false}
          actions={(
            <>
              <button
                className="s2v-lift"
                disabled={screen === 'tester'}
                title="Generate a single clip from one prompt on any Runway model — it never touches your film projects."
                onClick={() => { setScreen('tester'); setAuto(false); autoRef.current = false; }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: screen === 'tester' ? T.live : 'rgba(245,158,11,0.12)', border: `1px solid ${T.live}`, color: screen === 'tester' ? '#1A1205' : T.live, fontSize: 12.5, fontWeight: 750, cursor: screen === 'tester' ? 'default' : 'pointer', padding: '7px 13px', borderRadius: 999 }}
              >
                <Sparkles size={14} /> Agent Studio
              </button>
              {showBack ? (
                <button className="s2v-ghost" onClick={() => { setScreen('library'); setLegacyOpen(null); setAuto(false); autoRef.current = false; loadLibrary(); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1px solid ${T.dim}`, color: T.muted, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '7px 11px', borderRadius: 9 }}>
                  <ArrowLeft size={14} /> Library
                </button>
              ) : null}
            </>
          )}
        />
      </div>

      {error ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(226,114,111,0.1)', borderBottom: '1px solid rgba(226,114,111,0.4)', color: T.fault, fontSize: 12.5, lineHeight: 1.5, padding: '9px 20px' }}>
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
          onOpenStudio={() => { setScreen('tester'); setAuto(false); autoRef.current = false; }}
          onArchive={handleArchiveFilm}
          onDelete={handleDeleteFilm}
        />
      ) : null}

      {screen === 'create' ? <CreateScreen initialText={quickText} initialShotUrl={handoffAttachment?.type.startsWith('image/') ? handoffAttachment.url : undefined} initialShotName={handoffAttachment?.name} busy={busy} onSubmit={handleCreate} /> : null}

      {screen === 'tester' ? <AgentStudio /> : null}

      {screen === 'board' && film ? (
        <RenderRoom
          film={film}
          scenes={scenes}
          note={note}
          busy={busy}
          auto={auto}
          autoPost={autoPost}
          onToggleAuto={handleToggleAuto}
          onToggleAutoPost={handleToggleAutoPost}
          onGenerate={handleGenerate}
          onPrepare={handlePrepare}
          onRetry={handleRetry}
          onRegenPrompt={handleRegenPrompt}
          onRedo={handleRedo}
          redoingId={redoingId}
          onUseCharRef={handleUseCharRef}
          onSkip={handleSkip}
        />
      ) : null}

      {screen === 'final' && film ? (
        <FinalScreen
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
        />
      ) : null}

      {screen === 'legacy' && legacyOpen ? <LegacyViewer legacy={legacyOpen} /> : null}

      {showDirector ? <AgentPanel scenes={scenes} busy={busy} onDirect={handleDirect} /> : null}

      {/* Persistent Final Assembly bar — in normal document flow BELOW the
          chat input, so neither can ever cover the other on any viewport. */}
      {(screen === 'board' || screen === 'final') && film && scenes.length ? (
        <AssemblyBar
          film={film}
          scenes={scenes}
          assembly={assembly}
          busy={busy}
          screen={screen}
          onFinalAssembly={() => { setScreen('final'); void handleFinalAssembly({ captions }); }}
          onPrepareAudio={handlePrepareAudio}
          onOpenFinal={() => setScreen('final')}
          onOpenBoard={() => setScreen('board')}
        />
      ) : null}
      <AgentChatProvider appContext={agentContext}>
        <AgentChatButton />
        <AgentChatPanel />
      </AgentChatProvider>
    </div>
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
            <video src={finalUrl} controls style={{ maxWidth: '100%', maxHeight: 440, borderRadius: 12, background: '#000' }} />
            <div style={{ marginTop: 12 }}>
              <a className="s2v-lift" href={finalUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: CTA_GRADIENT, color: '#1A1205', borderRadius: 10, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none', boxShadow: '0 2px 14px rgba(245,158,11,0.32)', transition: 'transform 0.18s ease, box-shadow 0.18s ease' }}>
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
          <div style={{ maxWidth: 460, textAlign: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 16, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(226,114,111,0.1)', border: '1px solid rgba(226,114,111,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <AlertCircle size={24} color={T.fault} />
            </div>
            <div style={{ color: T.bone, fontSize: 16.5, fontWeight: 700, letterSpacing: -0.2, marginBottom: 8 }}>This screen hit a snag</div>
            <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Your film's progress is saved after every step — reopen it from the library and it picks up where it left off.
            </div>
            <button onClick={() => this.setState({ error: null })} style={{ background: CTA_GRADIENT, color: '#1A1205', border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
              Back to your films
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <S2VBoundary>
      <ScriptToVideoApp />
    </S2VBoundary>
  );
}
