/**
 * Script-to-Video — sequential AI clip pipeline (Sep 2026 rebuild).
 *
 *   Script → Opus 5 reads the WHOLE story → sequential clip plan (4/6/8/10s)
 *          → one prompt at a time (global + scene + continuity context)
 *          → user-triggered generation on the Google video model (Omni Flash)
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
import { AlertCircle, ArrowLeft, Clapperboard, Download } from 'lucide-react';
import { Film, FilmScene, T, db } from './api';
import {
  AssemblyProgress, allScenesDone, assembleReadyFilm, autoPostProduce,
  autoProduce, changeMusicDirection, changeNarrationVoice,
  createAndSegmentFilm, generateScene, prepareFilmAudioStage, prepareScene,
  regenerateNarration, regenerateScenePrompt, regenerateSfx, resumeFilm,
  retryAudioLayer, retryScene, runAudioLayerStep, runFinalAssembly,
  skipAudioLayer, skipScene, useCharacterReferenceFallback,
} from './pipeline/orchestrator';
import { audioReady } from './pipeline/audio';
import Library, { LegacyFilm } from './Library';
import { CreateScreen } from './CreateFlow';
import RenderRoom from './RenderRoom';
import { FinalScreen } from './ReviewFinish';
import AgentPanel from './AgentPanel';
import AssemblyBar from './AssemblyBar';

type Screen = 'library' | 'create' | 'board' | 'final' | 'legacy';

const APP_CSS = `
  .s2v-app button { transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; }
  .s2v-app button:focus-visible, .s2v-app a:focus-visible { outline: 2px solid ${T.live}; outline-offset: 2px; }
  .s2v-app input:focus-visible, .s2v-app textarea:focus-visible, .s2v-app select:focus-visible { outline: none; border-color: ${T.live} !important; box-shadow: 0 0 0 3px rgba(232,163,60,0.18); }
  .s2v-app input, .s2v-app textarea, .s2v-app select { transition: border-color 0.18s ease, box-shadow 0.18s ease; }
  .s2v-row { transition: background-color 0.16s ease; border-radius: 10px; }
  .s2v-row:hover { background: rgba(255,255,255,0.035) !important; }
  .s2v-lift:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
  .s2v-lift:active:not(:disabled) { transform: translateY(0); }
  .s2v-ghost:hover:not(:disabled) { color: ${T.bone} !important; background: rgba(255,255,255,0.05) !important; }
  .s2v-app ::-webkit-scrollbar { width: 8px; height: 8px; }
  .s2v-app ::-webkit-scrollbar-thumb { background: ${T.dim}; border-radius: 999px; }
  .s2v-app ::-webkit-scrollbar-track { background: transparent; }
`;

function ScriptToVideoApp() {
  const [screen, setScreen] = useState<Screen>('library');
  const [films, setFilms] = useState<Film[]>([]);
  const [legacy, setLegacy] = useState<LegacyFilm[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [quickText, setQuickText] = useState('');
  const [film, setFilm] = useState<Film | null>(null);
  const [scenes, setScenes] = useState<FilmScene[]>([]);
  const [auto, setAuto] = useState(false);
  const [autoPost, setAutoPost] = useState(true);
  const [captions, setCaptions] = useState(false);
  const [assembly, setAssembly] = useState<AssemblyProgress | null>(null);
  const [legacyOpen, setLegacyOpen] = useState<LegacyFilm | null>(null);

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

  function adopt(f: Film, list: FilmScene[]) {
    engineFilm.current = f;
    engineScenes.current = list;
    setFilm({ ...f });
    setScenes(list.map((s) => ({ ...s })));
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

  async function handleCreate(params: { script: string; aspect: any; screenshotUrl: string | null; note: string; videoModel?: string }) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      const res = await createAndSegmentFilm({ script: params.script, aspect: params.aspect, referenceImageUrl: params.screenshotUrl, note: params.note, videoModel: params.videoModel }, hooks);
      const freshScenes = await db.listScenes(res.film.id);
      adopt(res.film, freshScenes);
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
  const handleUseCharRef = withEngine((f, list, s) => useCharacterReferenceFallback(f, list, s, hooks));
  const handleSkip = withEngine((f, list, s) => skipScene(f, list, s, hooks));

  function handleToggleAuto(on: boolean) {
    setAuto(on);
    autoRef.current = on;
    const f = engineFilm.current;
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

  const handleSkipLayer = (layer: 'music' | 'sfx') => {
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

  async function handleDirect(scene: FilmScene, instruction: string): Promise<string> {
    const f = engineFilm.current;
    const engineScene = engineScenes.current.find((s) => s.id === scene.id);
    if (!f || !engineScene) throw new Error('Open a film first.');
    if (running.current) throw new Error('The pipeline is busy — wait for the current step to finish.');
    running.current = true;
    try {
      await regenerateScenePrompt(f, engineScenes.current, engineScene, hooks, instruction);
      return `Scene ${engineScene.idx + 1} has a new prompt — review it and generate when ready.`;
    } finally {
      running.current = false;
    }
  }

  async function openFilm(f: Film) {
    setError(''); setNote(''); setAssembly(null);
    setAuto(false); autoRef.current = false;
    advancedFor.current = null; postKickedFor.current = null;
    try {
      const list = await db.listScenes(f.id);
      adopt(f, list);
      const scenesDone = allScenesDone(list);
      if (f.status === 'ready' && f.final_video_url) { setScreen('final'); advancedFor.current = f.id; }
      else if (scenesDone) {
        // Scenes are complete — land directly in post-production, and resume
        // the audio pipeline automatically when Auto-complete is on.
        setScreen('final');
        advancedFor.current = f.id;
        if (autoPostRef.current && !audioReady(f.audio) && !f.error && !running.current) {
          postKickedFor.current = f.id;
          void run(() => autoPostProduce(engineFilm.current!, engineScenes.current, hooks));
        }
      } else setScreen('board');
      // Adopt in-flight renders and re-arm the pipeline head (prompt prep only —
      // generation always waits for a click).
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

  // ------- render -------

  const showBack = screen !== 'library';
  const showDirector = ['board', 'final'].includes(screen) && scenes.length > 0;

  return (
    <div className="s2v-app" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', background: T.canvas, fontFamily: T.sans, overflow: 'hidden' }}>
      <style>{APP_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px', borderBottom: `1px solid ${T.raised}`, flexShrink: 0 }}>
        {showBack ? (
          <button className="s2v-ghost" onClick={() => { setScreen('library'); setLegacyOpen(null); setAuto(false); autoRef.current = false; loadLibrary(); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: T.muted, fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '6px 10px', margin: '-6px -10px', borderRadius: 8 }}>
            <ArrowLeft size={15} /> Library
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(232,163,60,0.12)', border: '1px solid rgba(232,163,60,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clapperboard size={14} color={T.live} />
            </div>
            <div style={{ color: T.bone, fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2 }}>Script to Video</div>
          </div>
        )}
        <div style={{ marginLeft: 'auto', color: T.dim, fontSize: 11.5 }}>
          Opus 5 directs · one clip at a time · FFmpeg reads every final frame and cuts the film.
        </div>
      </div>

      {error ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(226,114,111,0.1)', borderBottom: '1px solid rgba(226,114,111,0.4)', color: T.fault, fontSize: 12.5, lineHeight: 1.5, padding: '9px 20px' }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
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
        />
      ) : null}

      {screen === 'create' ? <CreateScreen initialText={quickText} busy={busy} onSubmit={handleCreate} /> : null}

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
              <a className="s2v-lift" href={finalUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', borderRadius: 10, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none', boxShadow: '0 2px 10px rgba(232,163,60,0.25)', transition: 'transform 0.18s ease, box-shadow 0.18s ease' }}>
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
        <div style={{ width: '100%', height: '100%', minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: T.canvas, fontFamily: T.sans }}>
          <div style={{ maxWidth: 460, textAlign: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 16, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(226,114,111,0.1)', border: '1px solid rgba(226,114,111,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <AlertCircle size={24} color={T.fault} />
            </div>
            <div style={{ color: T.bone, fontSize: 16.5, fontWeight: 700, letterSpacing: -0.2, marginBottom: 8 }}>This screen hit a snag</div>
            <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Your film's progress is saved after every step — reopen it from the library and it picks up where it left off.
            </div>
            <button onClick={() => this.setState({ error: null })} style={{ background: T.live, color: '#1A1205', border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
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
