/**
 * Script-to-Video — the 10-stage autonomous pipeline (PRD v1.0).
 *
 * Give it a word, a line, or a script. Come back to a finished video.
 *
 * The pipeline itself lives server-side in the s2v-run server function
 * (input → intent → frozen scene plan → character bible → render strategies →
 * LLM judge → repair ladder → assembly → opt-in post → MP4 export). This app
 * is a live view onto that run: closing the tab never stops a render.
 *
 * Screens: Library · Create · Brief · Blueprint · Render room · Review ·
 * Finish, with the Agentic Verge command bar docked on every run screen.
 */
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Download } from 'lucide-react';
import { api, AgentEvent, CharacterRow, LegacyProject, Project, Question, SceneRow, T } from './api';
import { captureFrames } from '../../lib/frameshotClient';
import Library from './Library';
import { BlueprintScreen, BriefScreen, CreateScreen } from './CreateFlow';
import RenderRoom from './RenderRoom';
import { FinishScreen, ReviewScreen } from './ReviewFinish';
import AgentPanel from './AgentPanel';

type Screen = 'library' | 'create' | 'brief' | 'blueprint' | 'run' | 'review' | 'finish' | 'legacy';

/** Anything the server may hand back as a list is read as a list, never trusted as one. */
function list<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function ScriptToVideoApp() {
  const [screen, setScreen] = useState<Screen>('library');
  const [projects, setProjects] = useState<Project[]>([]);
  const [legacy, setLegacy] = useState<LegacyProject[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quickText, setQuickText] = useState('');

  const [project, setProject] = useState<Project | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [blueprint, setBlueprint] = useState<{ scenes: any[]; characters: any[]; assumptions: string[] }>({ scenes: [], characters: [], assumptions: [] });
  const [legacyOpen, setLegacyOpen] = useState<LegacyProject | null>(null);

  const pollRef = useRef<any>(null);
  const tickBusy = useRef(false);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    try {
      const res = await api.list();
      setProjects(list<Project>(res?.projects));
      setLegacy(list<LegacyProject>(res?.legacy).map((l) => ({ ...l, clips: list<string>(l?.clips) })));
      setError('');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLibLoading(false);
    }
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const refreshStatus = useCallback(async (pid: number) => {
    try {
      const st = await api.status(pid);
      // A status answer without a project would otherwise leave every screen
      // reading fields off `undefined` — keep the last good project instead.
      if (st?.project) setProject(st.project);
      setScenes(list<SceneRow>(st?.scenes));
      setCharacters(list<CharacterRow>(st?.characters).filter((c) => c && c.status !== 'superseded' && !!c.name));
      setEvents(list<AgentEvent>(st?.events));
      return st?.project || null;
    } catch (e) { return null; }
  }, []);

  // The run poll: the browser is only a VIEW onto server state, but while it is
  // open it also ticks the machine forward so progress is fast. Background
  // progress is covered by the platform watcher sweeping every 5 minutes
  // (twelve staggered hourly schedules), so stalls recover within ~5 minutes.
  useEffect(() => {
    clearInterval(pollRef.current);
    const active = project && ['casting', 'rendering', 'assembling', 'post', 'review'].includes(project.status);
    const watching = ['run', 'review', 'finish', 'blueprint'].includes(screen);
    if (!project || !watching) return;
    pollRef.current = setInterval(async () => {
      const p = projectRef.current;
      if (!p || tickBusy.current) return;
      tickBusy.current = true;
      try {
        if (['casting', 'rendering', 'assembling', 'post'].includes(p.status) || (p.status === 'review' && scenes.some((s) => ['rendering', 'judging', 'prepping'].includes(s.status)))) {
          try { await api.tick(p.id); } catch (e) { /* lease or transient — status still refreshes */ }
        }
        const fresh = await refreshStatus(p.id);
        if (fresh && screenRef.current === 'run' && fresh.status === 'ready') setScreen('finish');
      } finally {
        tickBusy.current = false;
      }
    }, active ? 6000 : 15000);
    return () => clearInterval(pollRef.current);
  }, [project?.id, project?.status, screen, refreshStatus, scenes]);

  // FRAME COURIER — server-side ffmpeg extraction is primary. If it fails and
  // this tab is open, the server requests a mandatory browser fallback through
  // scene.frames_requested_at. The courier captures the exact final frame plus
  // 4–6 720p-capped PNGs from the last second and returns them through
  // attach_frames. A partial capture is retried while this request remains
  // active; raw diagnostics stay in the developer console and Details panel.
  const framingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const p = projectRef.current;
    if (!p) return;
    scenes
      .filter((s) => (s as any).frames_requested_at && !(s as any).browser_frames && s.clip_url && s.status === 'judging')
      .forEach((s) => {
        const key = `${s.id}:${(s as any).frames_requested_at}`;
        if (framingRef.current.has(key)) return;
        framingRef.current.add(key);
        void (async () => {
          try {
            const frames = await captureFrames(String(s.clip_url), 6);
            if (frames.length < 4) throw new Error(`Captured ${frames.length} of the required 4 tail frames.`);
            await api.attachFrames(p.id, s.id, frames);
            setError('');
            await refreshStatus(p.id);
          } catch (captureError: any) {
            // Do not pin a failed request in the de-duplication set: the next
            // status refresh gets one fresh attempt while the server is still
            // waiting. Keep raw diagnostics out of the customer-facing banner.
            framingRef.current.delete(key);
            console.warn(`[ScriptToVideo] shot ${s.idx} browser frame capture failed:`, captureError);
            setError("We couldn't check this shot yet. Retrying…");
          }
        })();
      });
  }, [scenes, refreshStatus]);

  // ------- flow handlers -------

  async function handleCreate(params: { input_text: string; upload_text?: string; mode: string; aspect_ratio: string; chips: string[]; focus: string; target_length_s: number; video_model: string }) {
    setBusy(true); setError('');
    try {
      const res = await api.create(params);
      setProject(res.project);
      setQuestions(list<Question>(res?.questions));
      setScenes([]); setCharacters([]); setEvents([]);
      setScreen('brief');
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function handleBrief(answers: Record<string, string>) {
    if (!project) return;
    setBusy(true); setError('');
    try {
      const res = await api.brief(project.id, answers);
      setProject(res.project);
      setBlueprint({ scenes: list<any>(res?.scenes), characters: list<any>(res?.characters), assumptions: list<string>(res?.assumptions) });
      setScreen('blueprint');
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function handleStart() {
    if (!project) return;
    setError('');
    try {
      const res = await api.start(project.id);
      setProject(res.project);
      setScreen('run');
      refreshStatus(res.project.id);
    } catch (e: any) { setError(String(e?.message || e)); }
  }

  function openProject(p: Project) {
    setProject(p);
    setScenes([]); setCharacters([]); setEvents([]);
    if (p.status === 'briefing') { setQuestions(list<Question>(p.questions)); setScreen('brief'); }
    else if (p.status === 'blueprint') { refreshStatus(p.id).then(() => setScreen('blueprint')); setBlueprint({ scenes: [], characters: [], assumptions: [] }); }
    else if (p.status === 'review') setScreen('review');
    else if (p.status === 'ready') setScreen('finish');
    else setScreen('run');
    refreshStatus(p.id);
  }

  const onActed = useCallback(() => { const p = projectRef.current; if (p) refreshStatus(p.id); }, [refreshStatus]);

  // ------- render -------

  const showAgent = ['create', 'brief', 'blueprint', 'run', 'review', 'finish'].includes(screen);
  const showBack = screen !== 'library';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', background: T.canvas, fontFamily: T.sans, overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${T.raised}`, flexShrink: 0 }}>
        {showBack ? (
          <button onClick={() => { setScreen('library'); setLegacyOpen(null); loadLibrary(); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', padding: 0 }}>
            <ArrowLeft size={15} /> Library
          </button>
        ) : (
          <div style={{ color: T.bone, fontSize: 14, fontWeight: 700 }}>Script to Video</div>
        )}
        <div style={{ marginLeft: 'auto', color: T.dim, fontSize: 11.5 }}>
          Give it a word, a line, or a script. Come back to a finished video.
        </div>
      </div>

      {error ? (
        <div style={{ background: 'rgba(226,114,111,0.1)', borderBottom: `1px solid ${T.fault}`, color: T.fault, fontSize: 12.5, padding: '8px 18px' }}>
          {error}
        </div>
      ) : null}

      {screen === 'library' ? (
        <Library
          projects={projects}
          legacy={legacy}
          loading={libLoading}
          onNew={() => { setQuickText(''); setScreen('create'); }}
          onOpen={openProject}
          onOpenLegacy={(l) => { setLegacyOpen(l); setScreen('legacy'); }}
          onQuickCreate={(t) => { setQuickText(t); setScreen('create'); }}
        />
      ) : null}

      {screen === 'create' ? <CreateScreen initialText={quickText} busy={busy} onSubmit={handleCreate} /> : null}

      {screen === 'brief' && project ? <BriefScreen questions={questions} busy={busy} onContinue={handleBrief} /> : null}

      {screen === 'blueprint' && project ? (
        <BlueprintScreen
          project={project}
          scenes={blueprint.scenes.length ? blueprint.scenes : scenes}
          characters={characters.length ? characters : (blueprint.characters as any)}
          assumptions={blueprint.assumptions}
          onStart={handleStart}
          onCancel={() => { setScreen('library'); loadLibrary(); }}
          onEditScene={async (idx, patch) => { await api.editScene(project.id, idx, patch); refreshStatus(project.id); }}
        />
      ) : null}

      {screen === 'run' && project ? (
        <RenderRoom
          project={project}
          scenes={scenes}
          characters={characters}
          events={events}
          onRecast={async (key, appearance) => { await api.recast(project.id, key, appearance); refreshStatus(project.id); }}
          onResume={async () => { try { const r = await api.resume(project.id); setProject(r.project); } catch (e: any) { setError(String(e?.message || e)); } }}
          onReview={() => setScreen('review')}
        />
      ) : null}

      {screen === 'review' && project ? (
        <ReviewScreen
          project={project}
          scenes={scenes}
          busy={busy}
          onRegen={async (idxs, note) => {
            setBusy(true);
            try { const r = await api.regen(project.id, idxs, note); setProject(r.project); refreshStatus(project.id); }
            catch (e: any) { setError(String(e?.message || e)); }
            finally { setBusy(false); }
          }}
          onCut={async (idxs) => { await api.cut(project.id, idxs); refreshStatus(project.id); }}
          onAssemble={async () => {
            setBusy(true);
            try { const r = await api.assemble(project.id); setProject(r.project); if (r.project.status === 'ready') setScreen('finish'); }
            catch (e: any) { setError(String(e?.message || e)); }
            finally { setBusy(false); refreshStatus(project.id); }
          }}
        />
      ) : null}

      {screen === 'finish' && project ? (
        <FinishScreen
          project={project}
          scenes={scenes}
          busy={busy}
          onApplyLayers={async (layers) => {
            const r = await api.layers(project.id, layers);
            setProject(r.project);
            refreshStatus(project.id);
          }}
          onBackToReview={() => setScreen('review')}
        />
      ) : null}

      {screen === 'legacy' && legacyOpen ? (
        <LegacyViewer legacy={legacyOpen} />
      ) : null}

      {showAgent ? <AgentPanel projectId={project?.id} onActed={onActed} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy playback
// ---------------------------------------------------------------------------

function LegacyViewer({ legacy: legacyOpen }: { legacy: LegacyProject }) {
  // A legacy row is whatever the old module happened to store, so every field
  // the player reads is normalised before it is touched.
  const clips = list<string>(legacyOpen?.clips).filter((c) => typeof c === 'string' && !!c);
  const finalUrl = typeof legacyOpen?.final_url === 'string' ? legacyOpen.final_url : '';
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ color: T.bone, fontSize: 19, fontWeight: 700 }}>{legacyOpen?.title || 'Legacy video'}</div>
        <div style={{ color: T.muted, fontSize: 12.5, marginTop: 4 }}>A project from the previous Script-to-Video — still fully accessible.</div>
        {finalUrl ? (
          <div style={{ marginTop: 16 }}>
            <video src={finalUrl} controls style={{ maxWidth: '100%', maxHeight: 440, borderRadius: 12, background: '#000' }} />
            <div style={{ marginTop: 12 }}>
              <a href={finalUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', borderRadius: 9, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
                <Download size={14} /> Download MP4
              </a>
            </div>
          </div>
        ) : null}
        {clips.length ? (
          <div style={{ marginTop: 22 }}>
            <div style={{ color: T.muted, fontSize: 13, marginBottom: 10 }}>Scene clips</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {clips.map((c, i) => (
                <video key={i} src={c} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
              ))}
            </div>
          </div>
        ) : null}
        {!finalUrl && !clips.length ? (
          <div style={{ color: T.dim, fontSize: 13, marginTop: 20 }}>This legacy project has no stored video files.</div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crash containment
// ---------------------------------------------------------------------------

// A throw anywhere below — including inside a <video> subtree or a CDN
// dependency's own code — used to unmount the whole app and leave the customer
// on a blank panel with a finished video they could not reach. The run itself
// is server-side and untouched, so the honest recovery is to say so and offer
// a retry that remounts the screens.
class S2VBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('[ScriptToVideo] crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ width: '100%', height: '100%', minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: T.canvas, fontFamily: T.sans }}>
          <div style={{ maxWidth: 460, textAlign: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 14, padding: '28px 24px' }}>
            <AlertCircle size={26} color={T.fault} style={{ display: 'block', margin: '0 auto 10px' }} />
            <div style={{ color: T.bone, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>This screen hit a snag</div>
            <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
              Your video is safe — the pipeline runs on our side and nothing stopped. Reopen the library to pick it up again.
            </div>
            <button onClick={() => this.setState({ error: null })} style={{ background: T.live, color: '#1A1205', border: 'none', borderRadius: 9, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
              Back to your videos
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
