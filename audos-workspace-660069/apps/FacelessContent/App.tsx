/**
 * FACELESS CONTENT — topic in, one finished faceless MP4 out.
 *
 * Four screens, in the order a run moves through them:
 *   Create    a single clean brief and one CTA. Nothing else on the screen.
 *   Progress  a terminal log that replaces the form, fed by a 2-second poll of
 *             the project row rather than by component state, so closing the
 *             tab and coming back lands exactly where the pipeline is.
 *   Result    the stitched film, its three title options, the full script and
 *             the writer's own fact-check list.
 *   History   every past run.
 *
 * No templates anywhere: the script, the shot prompts and every frame are
 * written from scratch on each run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Download,
  Plus, RefreshCw, Sparkles, Wand2, X,
} from 'lucide-react';
import {
  F, FC_CSS, cardStyle, ctaStyle, dividerStyle, headingGradient, inputStyle,
  labelStyle, panelStyle,
} from './theme';
import { LENGTHS, NICHES, Niche, Orientation, ScriptBlock, FactCheckItem } from './prompts';
import { VideoModel, suggestTopic } from './api';
import { FcProject, FcScene, LogLine, findRunningProject, getProject, listProjects, listScenes } from './store';
import { RunBrief, runFacelessPipeline } from './pipeline';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import type { VidvergeAttachment } from '../../lib/vidvergeHandoff';
import VideoIntegrationPicker from '../../components/VideoIntegrationPicker';
import VergeLoader from '../../components/VergeLoader';
import VideoErrorCard from '../../components/video/VideoErrorCard';
import VideoGeneratingState from '../../components/video/VideoGeneratingState';
import {
  loadVideoSelection, saveVideoSelection, type VideoIntegrationId,
} from '../../lib/videoIntegrations';
import { withBrandContext } from '../../components/BrandContextLayer';

type Tab = 'create' | 'history';
type View = 'form' | 'progress' | 'result';

/** How long a polled run may sit completely still before it is called dead. */
const STALL_AFTER_MS = 12 * 60 * 1000;

const ORIENTATIONS: { id: Orientation; label: string }[] = [
  { id: '16:9', label: '16:9 Landscape' },
  { id: '9:16', label: '9:16 Portrait' },
];

// ---------------------------------------------------------------- atoms ----

function Spin({ size = 15, label = 'Working' }: { size?: number; label?: string }) {
  return <VergeLoader size={Math.round(size * 2.2)} label={label} />;
}

function Pill(props: { active: boolean; onClick: () => void; children: any; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="fc-pill"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.active}
      style={{
        background: props.active ? F.accentGradient : F.raised,
        border: `1px solid ${props.active ? F.accentBright : F.line}`,
        color: props.active ? '#fff' : F.soft,
        boxShadow: props.active ? F.accentGlow : 'none',
        backdropFilter: F.glass, WebkitBackdropFilter: F.glass,
        borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 600,
        fontFamily: F.sans, cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
      }}
    >{props.children}</button>
  );
}

function GhostBtn(props: { onClick?: () => void; children: any; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      className="fc-cta"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        background: F.raised, border: `1px solid ${F.line}`, color: F.soft,
        backdropFilter: F.glass, WebkitBackdropFilter: F.glass,
        borderRadius: 12, padding: '10px 16px', fontSize: 13.5, fontWeight: 600,
        fontFamily: F.sans, cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
    >{props.children}</button>
  );
}

function Badge({ children }: { children: any }) {
  return (
    <span style={{
      display: 'inline-block', background: F.accentSoft, color: F.accentLight,
      border: `1px solid ${F.accentBright}`, borderRadius: 999, padding: '2px 9px',
      fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{children}</span>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div style={{
      position: 'absolute', right: 20, bottom: 20, zIndex: 20, maxWidth: 380,
      background: F.card, border: `1px solid ${F.warn}`, borderRadius: 16,
      backdropFilter: F.glass, WebkitBackdropFilter: F.glass,
      padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      <AlertTriangle size={15} color={F.warn} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 13, color: F.soft, lineHeight: 1.5, flex: 1 }}>{message}</span>
      <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: F.muted, cursor: 'pointer', padding: 0 }}>
        <X size={14} />
      </button>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function nicheLabel(id: string | null): string {
  return NICHES.filter((n) => n.id === id)[0]?.label || 'Video';
}

// ------------------------------------------------------------- terminal ----

function Terminal({ lines }: { lines: LogLine[] }) {
  const glyph = (state: LogLine['state']) => (
    state === 'done' ? '✔' : state === 'active' ? '►' : state === 'failed' ? '✖' : ' '
  );
  const colour = (state: LogLine['state']) => (
    state === 'done' ? F.terminal : state === 'active' ? F.accentLight : state === 'failed' ? F.bad : F.muted
  );
  return (
    <div style={{
      background: F.terminalBg, border: `1px solid ${F.line}`, borderRadius: 16,
      backdropFilter: F.glass, WebkitBackdropFilter: F.glass,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.4)',
      padding: '20px 22px', fontFamily: F.mono, fontSize: 13.5, lineHeight: 1.9,
      minHeight: 240, maxHeight: 460, overflowY: 'auto',
    }}>
      {lines.length === 0 ? (
        <div style={{ color: F.muted }}>Starting the run<span className="fc-caret">_</span></div>
      ) : lines.map((line, i) => (
        <div
          key={`${i}-${line.text}`}
          className="fc-line"
          style={{ color: colour(line.state), animationDelay: `${Math.min(i, 12) * 0.05}s`, whiteSpace: 'pre-wrap' }}
        >
          <span style={{ display: 'inline-block', width: 18 }}>{glyph(line.state)}</span>
          {line.text}
          {line.state === 'active' ? <span className="fc-caret"> _</span> : null}
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- the app ----

const BrandedFacelessContentApp = withBrandContext(FacelessContentApp, 'Faceless Content');
export default BrandedFacelessContentApp;
function FacelessContentApp() {
  const [tab, setTab] = useState<Tab>('create');
  const [view, setView] = useState<View>('form');

  // Brief
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState<Niche>('explainer');
  const [lengthTarget, setLengthTarget] = useState<number>(5);
  const [orientation, setOrientation] = useState<Orientation>('16:9');
  const [videoModel, setVideoModel] = useState<VideoModel>('omni_flash');
  const initialVideo = loadVideoSelection();
  const [videoIntegration, setVideoIntegration] = useState<VideoIntegrationId>(() => initialVideo.integration);
  const [videoModelId, setVideoModelId] = useState<string>(() => initialVideo.model);
  const [suggesting, setSuggesting] = useState(false);
  const [handoffAttachment, setHandoffAttachment] = useState<VidvergeAttachment | null>(null);

  // Run
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<FcProject | null>(null);
  const [scenes, setScenes] = useState<FcScene[]>([]);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<FcProject[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Result UI
  const [scriptOpen, setScriptOpen] = useState(false);
  const [copiedTitle, setCopiedTitle] = useState<number | null>(null);

  // True only in the tab that is actually driving the pipeline.
  const running = useRef(false);
  const handoffHandled = useRef(false);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistory(await listProjects());
    setHistoryLoading(false);
  }, []);

  const openResult = useCallback(async (p: FcProject) => {
    setProject(p);
    setProjectId(p.id);
    setScenes(await listScenes(p.id));
    setScriptOpen(false);
    setTab('create');
    setView('result');
  }, []);

  useEffect(() => {
    const handoff = consumeVidvergeHandoff('faceless-content');
    if (!handoff) return;
    handoffHandled.current = true;
    if (handoff.projectId != null) {
      void (async () => {
        const row = await getProject(String(handoff.projectId));
        if (!row) return;
        if (row.status === 'done' && row.final_video_url) await openResult(row);
        else {
          setProjectId(row.id);
          setProject(row);
          setLogLines(Array.isArray(row.progress_log) ? row.progress_log : []);
          setTopic(row.topic || '');
          setTab('create');
          setView('progress');
        }
      })();
      return;
    }
    setTopic(String(handoff.prompt || ''));
    setHandoffAttachment(handoff.attachment || null);
    if (handoff.videoIntegration) setVideoIntegration(handoff.videoIntegration as VideoIntegrationId);
    if (handoff.videoModel) setVideoModelId(handoff.videoModel);
    setTab('create');
    setView('form');
  }, [openResult]);

  // Resume: the newest unfinished run reopens its terminal on mount.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await refreshHistory();
      const live = await findRunningProject();
      if (!alive || !live || running.current || handoffHandled.current) return;
      setProjectId(live.id);
      setProject(live);
      setLogLines(Array.isArray(live.progress_log) ? live.progress_log : []);
      setTopic(live.topic || '');
      if (live.niche) setNiche(live.niche);
      if (live.length_target) setLengthTarget(live.length_target);
      if (live.orientation) setOrientation(live.orientation);
      setView('progress');
    })().catch((resumeError) => {
      console.warn('[FacelessContent] could not resume the latest run:', resumeError);
    });
    return () => { alive = false; };
  }, [refreshHistory]);

  // The 2-second project poll that drives the progress view.
  useEffect(() => {
    if (view !== 'progress' || !projectId) return undefined;
    let alive = true;
    // A run whose tab was closed leaves its row mid-flight, and this view would
    // otherwise reopen that dead terminal and wait on it for good. Nothing
    // moving for this long, in a tab that is not itself driving the pipeline,
    // is reported as a stopped run with a way out of it.
    let lastSignature = '';
    let lastMovedAt = Date.now();
    const tick = async () => {
      const p = await getProject(projectId);
      if (!alive || !p) return;
      setProject(p);
      // The driving tab already has fresher lines from the pipeline itself.
      if (!running.current && Array.isArray(p.progress_log)) setLogLines(p.progress_log);
      const signature = `${p.status || ''}|${p.stage || ''}|${JSON.stringify(p.progress_log || [])}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastMovedAt = Date.now();
      }
      if (p.status === 'done' && p.final_video_url) {
        setScenes(await listScenes(p.id));
        if (!alive) return;
        setView('result');
        void refreshHistory();
      } else if (p.status === 'failed') {
        setError(p.error_msg || 'The run failed.');
      } else if (!running.current && Date.now() - lastMovedAt > STALL_AFTER_MS) {
        setError('This run has not moved for a while — the tab that was driving it was most likely closed before it finished. Try again runs it from the top; nothing already finished is lost.');
      }
    };
    void tick().catch((pollError) => console.warn('[FacelessContent] project refresh failed:', pollError));
    const timer = window.setInterval(() => {
      void tick().catch((pollError) => console.warn('[FacelessContent] project refresh failed:', pollError));
    }, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [view, projectId, refreshHistory]);

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      setTopic(await suggestTopic(niche));
    } catch (e: any) {
      setError(e?.message || 'A topic could not be suggested right now.');
    } finally {
      setSuggesting(false);
    }
  }

  async function handleGenerate(brief?: RunBrief) {
    const topicWithReference = handoffAttachment
      ? `${topic.trim()}\n\nReference asset (${handoffAttachment.name}): ${handoffAttachment.url}`
      : topic.trim();
    const run: RunBrief = brief || {
      topic: topicWithReference, niche, lengthTarget, orientation, videoModel,
      videoIntegration, videoModelId,
    };
    if (!run.topic) { setError('Give the video a topic first.'); return; }
    setError(null);
    setLogLines([]);
    setScenes([]);
    setProject(null);
    setProjectId(null);
    setView('progress');
    running.current = true;
    try {
      await runFacelessPipeline(run, {
        onLog: setLogLines,
        onProjectId: setProjectId,
        onToast: setToast,
      });
      void refreshHistory();
    } catch (e: any) {
      setError(e?.message || 'The run failed.');
    } finally {
      running.current = false;
    }
  }

  function startNew() {
    running.current = false;
    setView('form');
    setProject(null);
    setProjectId(null);
    setScenes([]);
    setLogLines([]);
    setError(null);
    setTopic('');
  }

  function copyTitle(title: string, index: number) {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(title).then(() => {
      setCopiedTitle(index);
      window.setTimeout(() => setCopiedTitle(null), 2000);
    }).catch(() => undefined);
  }

  const titles: string[] = Array.isArray(project?.titles_json) ? (project!.titles_json as string[]) : [];
  const blocks: ScriptBlock[] = Array.isArray(project?.script_json) ? (project!.script_json as ScriptBlock[]) : [];
  const facts: FactCheckItem[] = Array.isArray(project?.fact_check_json) ? (project!.fact_check_json as FactCheckItem[]) : [];

  return (
    <div
      className="fc-root"
      style={{
        position: 'relative', height: '100%', overflowY: 'auto',
        background: F.bg, color: F.ink, fontFamily: F.sans,
      }}
    >
      <style>{FC_CSS}</style>

      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '30px 26px 70px' }}>
        {/* ---- header + tabs ---- */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: '0 0 5px', fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', ...headingGradient }}>Faceless Content</h1>
            <p style={{ margin: 0, fontSize: 13.5, color: F.muted }}>
              A topic in, a finished faceless video out. Researched, scripted, filmed and cut from scratch every time.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['create', 'history'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); if (t === 'history') void refreshHistory(); }}
                style={{
                  background: tab === t ? F.accentSoft : 'transparent',
                  border: `1px solid ${tab === t ? F.lineStrong : 'transparent'}`,
                  color: tab === t ? F.ink : F.muted,
                  backdropFilter: tab === t ? F.glass : undefined,
                  WebkitBackdropFilter: tab === t ? F.glass : undefined,
                  borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
                  fontFamily: F.sans, cursor: 'pointer', textTransform: 'capitalize',
                }}
              >{t}</button>
            ))}
          </div>
        </div>

        <hr style={{ ...dividerStyle, margin: '0 0 26px' }} />

        {/* ================= CREATE ================= */}
        {tab === 'create' && view === 'form' && (
          <div style={{ maxWidth: 640 }}>
            <div style={cardStyle}>
              <span style={labelStyle}>Topic</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input
                  className="fc-input"
                  style={inputStyle}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What’s your video about?"
                />
                <GhostBtn onClick={() => void handleSuggest()} disabled={suggesting} title="Have the writer suggest a topic for this niche">
                  {suggesting ? <Spin size={14} label="Suggesting a topic" /> : <Sparkles size={14} />} Suggest
                </GhostBtn>
              </div>

              {handoffAttachment ? (
                <div style={{ ...panelStyle, marginTop: 12, fontSize: 12.5, color: F.soft }}>
                  Attached reference: {handoffAttachment.name}
                </div>
              ) : null}

              <div style={{ height: 22 }} />
              <span style={labelStyle}>Niche</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {NICHES.map((n) => (
                  <Pill key={n.id} active={niche === n.id} onClick={() => setNiche(n.id)}>{n.label}</Pill>
                ))}
              </div>

              <div style={{ height: 22 }} />
              <span style={labelStyle}>Target length</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {LENGTHS.map((m) => (
                  <Pill key={m} active={lengthTarget === m} onClick={() => setLengthTarget(m)}>{m} min</Pill>
                ))}
              </div>

              <div style={{ height: 22 }} />
              <span style={labelStyle}>Orientation</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ORIENTATIONS.map((o) => (
                  <Pill key={o.id} active={orientation === o.id} onClick={() => setOrientation(o.id)}>{o.label}</Pill>
                ))}
              </div>

              <div style={{ height: 22 }} />
              <VideoIntegrationPicker
                label="Video provider"
                integration={videoIntegration}
                model={videoModelId}
                sceneOnly
                onChange={(integration, model) => {
                  setVideoIntegration(integration);
                  setVideoModelId(model);
                  saveVideoSelection(integration, model);
                }}
                note="Scenes film one after another; each scene seeds from the last frame of the previous clip for visual continuity."
              />
              {videoModelId === 'gemini-omni-flash-preview' ? (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: F.muted, lineHeight: 1.6 }}>
                  Omni Flash accepts a seed frame plus reference images — best when a face, product or mascot must carry across every cut.
                </p>
              ) : null}

              {error ? (
                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 18, color: F.bad, fontSize: 13, lineHeight: 1.55 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{error}</span>
                </div>
              ) : null}

              <button
                type="button"
                className="fc-cta"
                onClick={() => void handleGenerate()}
                disabled={!topic.trim()}
                style={{
                  ...ctaStyle,
                  width: '100%', marginTop: 24, padding: '16px 20px', fontSize: 15.5,
                  cursor: topic.trim() ? 'pointer' : 'not-allowed',
                  opacity: topic.trim() ? 1 : 0.45,
                  boxShadow: topic.trim() ? F.accentGlow : 'none',
                }}
              >
                <Wand2 size={17} /> Generate
              </button>
            </div>
          </div>
        )}

        {/* ================= PROGRESS ================= */}
        {tab === 'create' && view === 'progress' && (
          <div style={{ maxWidth: 760 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <Badge>{nicheLabel(project?.niche || niche)}</Badge>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{project?.topic || topic}</span>
              <span style={{ fontSize: 12, color: F.muted }}>{project?.stage || 'Starting…'}</span>
            </div>

            <div
              className={error ? undefined : 'fc-sweep'}
              style={{ height: 2, borderRadius: 999, marginBottom: 12, background: error ? F.line : F.accentSoft }}
            />

            {error ? null : (
              <VideoGeneratingState
                label={project?.stage || 'Generating your faceless video'}
                detail="Researching, scripting, filming and assembling each scene"
                style={{ marginBottom: 18 }}
              />
            )}

            <Terminal lines={logLines} />

            {error ? (
              <div style={{ marginTop: 16 }}>
                <VideoErrorCard
                  error={error}
                  engineId={videoModelId}
                  subject="this faceless video"
                  onRetry={() => void handleGenerate()}
                />
                <div style={{ marginTop: 12 }}>
                  <GhostBtn onClick={startNew}><Plus size={14} /> New video</GhostBtn>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, flex: '1 1 420px', fontSize: 12.5, color: F.muted, lineHeight: 1.7 }}>
                  Scenes are filmed one after another so each can seed from the last frame of the one before it — that is what keeps the
                  look consistent, and it is why this takes a while. You can close the tab; reopening Faceless Content picks the run back up.
                </p>
                <GhostBtn onClick={startNew} title="Leave this run and start a fresh brief">
                  <Plus size={14} /> New video
                </GhostBtn>
              </div>
            )}
          </div>
        )}

        {/* ================= RESULT ================= */}
        {tab === 'create' && view === 'result' && project && (
          <div>
            <div style={{ background: '#000', borderRadius: 18, overflow: 'hidden', border: `1px solid ${F.lineStrong}`, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
              <video
                src={project.final_video_url || ''}
                controls
                playsInline
                style={{ width: '100%', maxHeight: 540, display: 'block', background: '#000' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
              <a href={project.final_video_url || '#'} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                <button
                  type="button"
                  className="fc-cta"
                  style={{ ...ctaStyle, padding: '11px 18px', fontSize: 14, fontWeight: 700, gap: 8 }}
                ><Download size={15} /> Download MP4</button>
              </a>
              <GhostBtn onClick={() => void handleGenerate({
                topic: project.topic || topic,
                niche: (project.niche || niche) as Niche,
                lengthTarget: project.length_target || lengthTarget,
                orientation: (project.orientation || orientation) as Orientation,
                videoModel, videoIntegration, videoModelId,
              })}><RefreshCw size={14} /> Regenerate</GhostBtn>
              <GhostBtn onClick={startNew}><Plus size={14} /> New video</GhostBtn>
              <span style={{ marginLeft: 'auto', fontSize: 12.5, color: F.muted }}>
                {scenes.filter((s) => s?.video_url).length} scenes · {formatDuration(Number(project.duration_seconds) || 0)} · {nicheLabel(project.niche)}
              </span>
            </div>

            {/* titles */}
            {titles.length ? (
              <div style={{ ...cardStyle, marginTop: 18 }}>
                <span style={labelStyle}>Title options</span>
                <div style={{ display: 'grid', gap: 8 }}>
                  {titles.map((t, i) => (
                    <div key={i} style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px' }}>
                      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, lineHeight: 1.45 }}>{t}</span>
                      <button
                        type="button"
                        onClick={() => copyTitle(t, i)}
                        title="Copy this title"
                        style={{ background: 'none', border: 'none', color: copiedTitle === i ? F.terminal : F.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontFamily: F.sans }}
                      >
                        {copiedTitle === i ? <Check size={14} /> : <Copy size={14} />}
                        {copiedTitle === i ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>
                {project.thumbnail_line ? (
                  <div style={{ marginTop: 12 }}>
                    <span style={labelStyle}>Thumbnail line</span>
                    <div style={{ fontSize: 14, fontWeight: 700, color: F.accentLight }}>{project.thumbnail_line}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* script accordion */}
            {blocks.length ? (
              <div style={{ ...cardStyle, marginTop: 14, padding: 0 }}>
                <button
                  type="button"
                  onClick={() => setScriptOpen((o) => !o)}
                  style={{
                    width: '100%', background: 'none', border: 'none', color: F.ink,
                    padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 9,
                    cursor: 'pointer', fontFamily: F.sans, fontSize: 14, fontWeight: 700, textAlign: 'left',
                  }}
                >
                  {scriptOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  Full script
                  <span style={{ fontWeight: 500, color: F.muted, fontSize: 12.5 }}>{blocks.length} blocks with timecodes</span>
                </button>
                {scriptOpen ? (
                  <div style={{ borderTop: `1px solid ${F.line}`, padding: '16px 18px', display: 'grid', gap: 16, maxHeight: 460, overflowY: 'auto' }}>
                    {blocks.filter(Boolean).map((b, i) => (
                      <div key={i}>
                        <div style={{ fontFamily: F.mono, fontSize: 12, color: F.accentLight, marginBottom: 5 }}>
                          [{b?.timecode}] {b?.block}
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.7, color: F.soft }}>{b?.vo}</div>
                        {b?.visual ? (
                          <div style={{ fontFamily: F.mono, fontSize: 11.5, color: F.muted, marginTop: 6, lineHeight: 1.6 }}>
                            VISUAL: {b.visual}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* fact check */}
            {facts.length ? (
              <div style={{ ...cardStyle, marginTop: 14 }}>
                <span style={labelStyle}>Fact check</span>
                <div style={{ display: 'grid', gap: 7 }}>
                  {facts.filter(Boolean).map((f, i) => {
                    const verified = /^verif/i.test(f?.verdict || '');
                    return (
                      <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.6 }}>
                        <span style={{ color: verified ? F.terminal : F.warn, flexShrink: 0, marginTop: 2 }}>
                          {verified ? <Check size={13} /> : <AlertTriangle size={13} />}
                        </span>
                        <span style={{ color: F.soft }}>{f?.claim}</span>
                        <span style={{ marginLeft: 'auto', color: verified ? F.terminal : F.warn, fontSize: 11.5, whiteSpace: 'nowrap' }}>{f?.verdict}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ================= HISTORY ================= */}
        {tab === 'history' && (
          <div>
            {historyLoading ? (
              <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <VergeLoader size={120} caption="Loading your videos" />
              </div>
            ) : history.length === 0 ? (
              <div style={{ ...cardStyle, color: F.muted, fontSize: 13.5, lineHeight: 1.7 }}>
                Nothing here yet. Head to <b style={{ color: F.ink }}>Create</b>, give it a topic and press Generate — finished videos land here.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                {history.filter(Boolean).map((p) => (
                  <div key={p.id} className="fc-card" style={{ ...cardStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <button
                      type="button"
                      onClick={() => { if (p.final_video_url) void openResult(p); }}
                      style={{
                        background: '#000', border: 'none', padding: 0, cursor: p.final_video_url ? 'pointer' : 'default',
                        aspectRatio: p.orientation === '9:16' ? '9/16' : '16/9', maxHeight: 240, overflow: 'hidden',
                      }}
                    >
                      {p.final_video_url ? (
                        <video src={`${p.final_video_url}#t=0.1`} preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.muted, fontSize: 12.5, background: F.raised }}>
                          {p.status === 'failed' ? 'Run failed' : <VergeLoader size={90} caption="Still rendering" />}
                        </div>
                      )}
                    </button>
                    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.45 }}>{p.topic || 'Untitled'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Badge>{nicheLabel(p.niche)}</Badge>
                        <span style={{ fontSize: 11.5, color: F.muted }}>{formatDate(p.created_at)}</span>
                        {p.duration_seconds ? (
                          <span style={{ fontSize: 11.5, color: F.muted }}>{formatDuration(Number(p.duration_seconds))}</span>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 'auto', display: 'flex', gap: 7, flexWrap: 'wrap', paddingTop: 4 }}>
                        {p.final_video_url ? (
                          <>
                            <GhostBtn onClick={() => void openResult(p)}>Open</GhostBtn>
                            <a href={p.final_video_url} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                              <GhostBtn><Download size={13} /> Download</GhostBtn>
                            </a>
                          </>
                        ) : (
                          <GhostBtn onClick={() => { setProjectId(p.id); setProject(p); setLogLines(Array.isArray(p.progress_log) ? p.progress_log : []); setTab('create'); setView('progress'); }}>
                            View progress
                          </GhostBtn>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
