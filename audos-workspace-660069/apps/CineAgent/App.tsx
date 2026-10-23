// CineAgent — the autonomous AI video editor.
//
// Upload → the agent analyzes, directs, edits, renders, reviews → download the
// finished MP4. The customer never configures a pipeline: preferences are
// optional, the plan is inspectable but never a prerequisite, and a refresh
// resumes the run from its last checkpoint (cine_projects).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Clapperboard, Download, Film, Loader2, RefreshCw, Settings2,
  Sparkles, Square, Trash2, Upload, Wand2, X, CheckCircle2, AlertTriangle, Eye,
} from 'lucide-react';
import type { ActivityLine, ProjectRow, QAReport, StageId, UserPrefs } from './lib/types';
import { STAGE_LABELS, STAGE_ORDER } from './lib/types';
import { createProject, deleteProject, listProjects, loadProject } from './lib/store';
import { runPipeline, type PipelineHandle } from './lib/pipeline';
import { computeTiming } from './lib/plan';
import { waitForWorkspaceBridge } from './lib/platform';
import VideoErrorCard from '../../components/video/VideoErrorCard';
import { withBrandContext } from '../../components/BrandContextLayer';
import { VideoHistory } from '../../components/VideoHistory';
import { saveVideoToHistory } from '../../lib/videoHistory';

const card: CSSProperties = {
  background: 'var(--vg-surface)',
  border: '1px solid var(--vg-border)',
  borderRadius: 12,
  transition: 'border-color 180ms cubic-bezier(.2,0,0,1), background 180ms cubic-bezier(.2,0,0,1)',
};

const accent = 'var(--vg-accent)';
const textPrimary = 'var(--vg-text)';
const textMuted = 'var(--vg-muted)';

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

const BrandedCineAgent = withBrandContext(App, 'CineAgent');
export default BrandedCineAgent;
function App() {
  const [view, setView] = useState<'home' | 'run'>('home');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [active, setActive] = useState<ProjectRow | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<UserPrefs>({ captions: 'auto', music: 'auto', framing: 'auto', intensity: 'balanced' });
  const [dragOver, setDragOver] = useState(false);
  const [homeError, setHomeError] = useState('');
  const handleRef = useRef<PipelineHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef(false);

  const refreshProjects = useCallback(async () => {
    try { setProjects(await listProjects(24)); } catch { /* table empty / not ready */ }
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);
  useEffect(() => () => { if (handleRef.current) handleRef.current.cancelled = true; }, []);

  // SHARED CROSS-APP HISTORY. The finished cut arrives on the project row
  // through the pipeline's onRow callback. Reopening a project that is already
  // finished seeds the set below (see resumeRun), so an old film is never
  // recorded a second time.
  const recordedResultUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const url = active?.status === 'done' ? String(active.result?.url || '') : '';
    if (!url || recordedResultUrls.current.has(url)) return;
    recordedResultUrls.current.add(url);
    void saveVideoToHistory({
      appId: 'cine-agent',
      title: active?.plan?.title || active?.name || 'CineAgent edit',
      videoUrl: url,
      durationSec: active?.result?.durationSec ? Math.round(active.result.durationSec) : null,
    });
  }, [active?.status, active?.result?.url, active?.result?.durationSec, active?.plan?.title, active?.name]);

  const startRun = useCallback(async (file: File) => {
    setHomeError('');
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
      setHomeError('Please choose a video file (MP4, MOV, WebM).');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setHomeError('This file is over the 50 MB upload limit. Trim or compress it, then try again. Nothing was charged.');
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const cleanPrefs: UserPrefs = { ...prefs };
      if (!cleanPrefs.tone?.trim()) delete cleanPrefs.tone;
      // The platform injects the workspace session asynchronously — starting
      // before it lands used to surface as a "sign in" error on first click.
      await waitForWorkspaceBridge(10000);
      const created = await createProject(file.name.replace(/\.[a-z0-9]+$/i, ''), cleanPrefs);
      const row = await loadProject(created.id);
      if (!row) throw new Error('Could not open the new project.');
      if (created.local) {
        row.activity = [...(row.activity || []), {
          t: Date.now(),
          text: 'Heads up: your session was not ready, so this project is saved on this device only (it still edits normally, but resumes only from this browser).',
          kind: 'warn',
        }];
      }
      const handle: PipelineHandle = { cancelled: false };
      handleRef.current = handle;
      setActive(row);
      setView('run');
      runPipeline(row, file, handle, { onRow: (r) => setActive({ ...r }) })
        .finally(() => { runningRef.current = false; refreshProjects(); });
    } catch (error) {
      runningRef.current = false;
      setHomeError(error instanceof Error ? error.message : String(error));
    }
  }, [prefs, refreshProjects]);

  const resumeRun = useCallback(async (row: ProjectRow) => {
    const fresh = (await loadProject(row.id)) || row;
    if (fresh.status === 'done' && fresh.result?.url) {
      recordedResultUrls.current.add(String(fresh.result.url));
    }
    setActive(fresh);
    setView('run');
    if (fresh.status === 'running' && !runningRef.current) {
      runningRef.current = true;
      const handle: PipelineHandle = { cancelled: false };
      handleRef.current = handle;
      runPipeline(fresh, null, handle, { onRow: (r) => setActive({ ...r }) })
        .finally(() => { runningRef.current = false; refreshProjects(); });
    }
  }, [refreshProjects]);

  const stopRun = useCallback(() => {
    if (handleRef.current) handleRef.current.cancelled = true;
  }, []);

  return (
    <div style={{ minHeight: '100%', color: textPrimary, fontFamily: "'Manrope', 'Segoe UI', sans-serif", padding: '32px clamp(16px, 4vw, 52px) 72px', background: 'var(--vg-gradient-ambient), var(--vg-bg)' }}>
      <style>{cineCss}</style>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 30 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--vg-accent-soft)', border: '1px solid var(--vg-border)' }}>
          <Wand2 size={24} color={accent as string} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: "'Space Grotesk', 'Segoe UI', sans-serif", fontSize: 28, lineHeight: '36px', fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--vg-text)' }}>CineAgent</h1>
          <p style={{ margin: 0, fontSize: 13, color: textMuted }}>Upload footage. The AI directs, edits, reviews — and hands you the finished film.</p>
        </div>
        {view === 'run' ? (
          <button onClick={() => { setView('home'); refreshProjects(); }} className="cine-btn" style={btnGhost}>
            <X size={15} /> Close
          </button>
        ) : null}
      </header>

      {view === 'home' ? (
        <HomeView
          projects={projects}
          prefs={prefs}
          setPrefs={setPrefs}
          prefsOpen={prefsOpen}
          setPrefsOpen={setPrefsOpen}
          dragOver={dragOver}
          setDragOver={setDragOver}
          error={homeError}
          onPick={() => fileInputRef.current?.click()}
          onFile={startRun}
          onOpen={resumeRun}
          onDelete={async (row) => { await deleteProject(row.id).catch(() => undefined); refreshProjects(); }}
        />
      ) : active ? (
        <RunView row={active} onStop={stopRun} onResume={() => resumeRun(active)} running={runningRef.current} />
      ) : null}

      <input
        ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) startRun(f); e.currentTarget.value = ''; }}
      />

      <div style={{ marginTop: 28, maxWidth: 1060, marginLeft: 'auto', marginRight: 'auto' }}>
        <VideoHistory />
      </div>
    </div>
  );
}

const btnGhost: CSSProperties = {
  display: 'inline-flex', minHeight: 44, alignItems: 'center', gap: 8, padding: '0 16px', fontSize: 14, fontWeight: 600,
  background: 'var(--vg-surface)', color: textPrimary, border: '1px solid var(--vg-control-border)',
  borderRadius: 10, cursor: 'pointer',
  transition: 'transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease',
};

const btnPrimary: CSSProperties = {
  display: 'inline-flex', minHeight: 44, alignItems: 'center', gap: 8, padding: '0 20px', fontSize: 14, fontWeight: 600,
  background: 'var(--vg-gradient-action)',
  color: 'var(--vg-on-accent)', border: 'none', borderRadius: 10, cursor: 'pointer',
  boxShadow: 'none',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease',
};

const cineCss = `
@keyframes cine-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.cine-btn:hover { background-color: var(--vg-hover); }
.cine-btn:focus-visible { outline: 2px solid var(--vg-focus); outline-offset: 3px; }
.cine-btn:active { transform: scale(0.98); }
button.cine-btn:hover { border-color: var(--space-border-strong, rgba(245,158,11,0.45)); }
.cine-input { transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease; }
.cine-input:focus { outline: none; border-color: color-mix(in srgb, var(--space-brand-primary, #f59e0b) 55%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--space-brand-primary, #f59e0b) 16%, transparent), 0 0 28px color-mix(in srgb, var(--space-brand-primary, #f59e0b) 18%, transparent); }
.cine-card { transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }
.cine-card:hover { transform: translateY(-2px); border-color: var(--space-border-strong, rgba(255,255,255,0.18)); box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
.cine-upload { position: relative; }
.cine-upload::before { content: ''; position: absolute; inset: 0; border-radius: 24px; padding: 2px; pointer-events: none; background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--space-brand-primary, #f59e0b) 60%, transparent) 0 12px, color-mix(in srgb, var(--space-text-accent, #E0A33A) 55%, transparent) 12px 24px, transparent 24px 34px); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; transition: background 0.2s ease; }
.cine-upload.cine-drag::before { background: linear-gradient(135deg, var(--space-brand-primary, #f59e0b), var(--space-text-accent, #E0A33A)); }
`;

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function HomeView(props: {
  projects: ProjectRow[];
  prefs: UserPrefs; setPrefs: (p: UserPrefs) => void;
  prefsOpen: boolean; setPrefsOpen: (b: boolean) => void;
  dragOver: boolean; setDragOver: (b: boolean) => void;
  error: string;
  onPick: () => void; onFile: (f: File) => void;
  onOpen: (row: ProjectRow) => void; onDelete: (row: ProjectRow) => void;
}) {
  const { projects, prefs, setPrefs, prefsOpen, setPrefsOpen, dragOver, setDragOver, error, onPick, onFile, onOpen, onDelete } = props;
  return (
    <div style={{ display: 'grid', gap: 26 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className={'cine-upload' + (dragOver ? ' cine-drag' : '')}
        style={{
          ...card, padding: 'clamp(36px, 10vw, 64px) clamp(16px, 6vw, 32px)', textAlign: 'center',
          border: 'none', borderRadius: 24,
          background: dragOver
            ? 'color-mix(in srgb, var(--space-brand-primary, #f59e0b) 9%, color-mix(in srgb, var(--space-surface-card, #15120A) 80%, transparent))'
            : card.background,
          boxShadow: dragOver
            ? '0 0 0 4px color-mix(in srgb, var(--space-brand-primary, #f59e0b) 14%, transparent), 0 18px 50px rgba(120,80,0,0.14)'
            : '0 18px 50px rgba(120,80,0,0.12)',
          transition: 'background 0.2s ease, box-shadow 0.2s ease',
        }}
      >
        <div style={{ width: 84, height: 84, margin: '0 auto 20px', borderRadius: 28, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, color-mix(in srgb, var(--space-brand-primary, #f59e0b) 18%, transparent), color-mix(in srgb, var(--space-text-accent, #E0A33A) 12%, transparent))', border: '1px solid color-mix(in srgb, var(--space-brand-primary, #f59e0b) 35%, transparent)', boxShadow: '0 0 40px color-mix(in srgb, var(--space-brand-primary, #f59e0b) 18%, transparent)' }}>
          <Upload size={36} color={accent as string} />
        </div>
        <h2 style={{ margin: '0 0 10px', fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>Drop your footage here</h2>
        <p style={{ margin: '0 0 26px', fontSize: 14.5, lineHeight: 1.6, color: textMuted, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
          Talking head, tutorial, screen recording, ad, podcast, vlog — the agent watches it, writes the edit,
          designs the motion graphics, scores it, renders it and reviews its own cut. Up to 50MB per upload.
        </p>
        <button onClick={onPick} className="cine-btn" style={btnPrimary}><Film size={17} /> Choose a video</button>
        {/* The failure is described rather than dumped: a wallet stop, a
            refused model and a dropped connection need different next steps,
            and Retry reopens the picker only when retrying can help. */}
        {error ? (
          <div style={{ marginTop: 18, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', textAlign: 'left' }}>
            <VideoErrorCard error={error} subject="this edit" onRetry={onPick} compact />
          </div>
        ) : null}

        <div style={{ marginTop: 26 }}>
          <button onClick={() => setPrefsOpen(!prefsOpen)} className="cine-btn" style={{ ...btnGhost, fontSize: 12 }}>
            <Settings2 size={14} /> {prefsOpen ? 'Hide' : 'Optional'} creative preferences
          </button>
        </div>
        {prefsOpen ? (
          <div style={{ marginTop: 18, display: 'grid', gap: 12, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', textAlign: 'left' }}>
            <input
              value={prefs.tone || ''}
              onChange={(e) => setPrefs({ ...prefs, tone: e.target.value })}
              placeholder="Anything you want the director to know? (tone, audience, must-keep moments) — optional"
              className="cine-input"
              style={{ width: '100%', padding: '14px 20px', fontSize: 13, color: textPrimary, background: 'color-mix(in srgb, var(--space-surface-muted, #18150A) 78%, transparent)', border: '1px solid var(--space-border-default, rgba(245,158,11,0.18))', borderRadius: 999, outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PrefSelect label="Captions" value={prefs.captions || 'auto'} options={['auto', 'on', 'off']} onChange={(v) => setPrefs({ ...prefs, captions: v as UserPrefs['captions'] })} />
              <PrefSelect label="Music" value={prefs.music || 'auto'} options={['auto', 'on', 'off']} onChange={(v) => setPrefs({ ...prefs, music: v as UserPrefs['music'] })} />
              <PrefSelect label="Framing" value={prefs.framing || 'auto'} options={['auto', 'fit', 'cover']} onChange={(v) => setPrefs({ ...prefs, framing: v as UserPrefs['framing'] })} />
              <PrefSelect label="Motion" value={prefs.intensity || 'balanced'} options={['subtle', 'balanced', 'expressive']} onChange={(v) => setPrefs({ ...prefs, intensity: v as UserPrefs['intensity'] })} />
            </div>
          </div>
        ) : null}
      </div>

      {projects.length ? (
        <section>
          <h3 style={{ margin: '4px 0 14px', fontSize: 15, fontWeight: 700, color: textMuted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Your projects</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
            {projects.map((p) => <ProjectCard key={p.id} row={p} onOpen={() => onOpen(p)} onDelete={() => onDelete(p)} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PrefSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: textMuted }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cine-input"
        style={{ padding: '8px 14px', fontSize: 12, color: textPrimary, background: 'color-mix(in srgb, var(--space-surface-muted, #18150A) 78%, transparent)', border: '1px solid var(--space-border-default, rgba(245,158,11,0.18))', borderRadius: 999 }}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function ProjectCard({ row, onOpen, onDelete }: { row: ProjectRow; onOpen: () => void; onDelete: () => void }) {
  const statusColor = row.status === 'done' ? 'var(--space-semantic-success, #10b981)'
    : row.status === 'failed' ? 'var(--space-semantic-danger, #ef4444)' : accent;
  return (
    <div className="cine-card" style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Clapperboard size={17} color={statusColor as string} />
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || 'Untitled'}</div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete project" className="cine-btn" style={{ ...btnGhost, padding: 7, borderRadius: 999 }}><Trash2 size={13} /></button>
      </div>
      <div style={{ fontSize: 12, color: textMuted }}>
        {row.status === 'done' && row.result ? ('Finished — ' + fmtClock(row.result.durationSec)) : row.status === 'failed' ? 'Failed — open for details' : (STAGE_LABELS[row.stage as StageId] || 'Running') + (row.progress?.detail ? ' · ' + row.progress.detail : '')}
      </div>
      <div style={{ height: 5, background: 'rgba(180,120,0,0.1)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: (row.status === 'done' ? 100 : row.progress?.pct || 0) + '%', height: '100%', background: statusColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run view
// ---------------------------------------------------------------------------

function RunView({ row, onStop, onResume, running }: { row: ProjectRow; onStop: () => void; onResume: () => void; running: boolean }) {
  const [showPlan, setShowPlan] = useState(false);
  const stageIdx = Math.max(0, STAGE_ORDER.indexOf(row.stage as StageId));
  const latestQA: QAReport | null = Array.isArray(row.qa) && row.qa.length ? row.qa[row.qa.length - 1] : null;
  const timing = row.plan ? computeTiming(row.plan) : null;

  return (
    <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 1060, margin: '0 auto' }}>
      {/* Status header */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{row.plan?.title || row.name || 'Your film'}</div>
            <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
              {row.status === 'done' ? 'Finished — review and download below.'
                : row.status === 'failed' ? 'The run stopped — details below.'
                : (STAGE_LABELS[row.stage as StageId] || 'Working') + (row.progress?.detail ? ' · ' + row.progress.detail : '')}
            </div>
          </div>
          {row.status === 'running' && running ? (
            <button onClick={onStop} className="cine-btn" style={btnGhost}><Square size={14} /> Pause</button>
          ) : row.status === 'running' ? (
            <button onClick={onResume} className="cine-btn" style={btnPrimary}><RefreshCw size={15} /> Resume run</button>
          ) : null}
        </div>
        {/* Stage rail */}
        <div style={{ display: 'flex', gap: 6, marginTop: 18, flexWrap: 'wrap' }}>
          {STAGE_ORDER.map((s, i) => {
            const done = row.status === 'done' || i < stageIdx;
            const activeStage = row.status === 'running' && i === stageIdx;
            return (
              <div key={s} style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: done ? 'color-mix(in srgb, var(--space-semantic-success, #10b981) 14%, transparent)' : activeStage ? 'color-mix(in srgb, var(--space-brand-primary, #f59e0b) 16%, transparent)' : 'rgba(180,120,0,0.06)',
                color: done ? 'var(--space-semantic-success-600, #34d399)' : activeStage ? accent : textMuted,
                border: '1px solid ' + (activeStage ? 'var(--space-border-strong, rgba(245,158,11,0.45))' : 'transparent'),
              }}>
                {done ? <CheckCircle2 size={13} /> : activeStage ? <Loader2 size={13} style={{ animation: 'cine-spin 1s linear infinite' }} /> : <span style={{ width: 13 }} />}
                {STAGE_LABELS[s]}
              </div>
            );
          })}
        </div>
        <div style={{ height: 6, background: 'rgba(180,120,0,0.1)', borderRadius: 3, overflow: 'hidden', marginTop: 14 }}>
          <div style={{ width: (row.status === 'done' ? 100 : row.progress?.pct || 0) + '%', height: '100%', background: row.status === 'failed' ? 'var(--space-semantic-danger, #ef4444)' : accent, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Result */}
      {row.status === 'done' && row.result ? (
        <div style={{ ...card, padding: 20 }}>
          <video controls playsInline src={row.result.url} style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 560 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <a href={row.result.url} download={(row.plan?.title || row.name || 'cineagent') + '.mp4'} target="_blank" rel="noreferrer" className="cine-btn" style={{ ...btnPrimary, textDecoration: 'none' }}>
              <Download size={16} /> Download MP4
            </a>
            <div style={{ fontSize: 13, color: textMuted }}>
              {fmtClock(row.result.durationSec)} final cut · 1080p · rendered {new Date(row.result.renderedAt).toLocaleString()}
            </div>
            {latestQA ? (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: latestQA.shippable ? 'var(--space-semantic-success-600, #34d399)' : accent }}>
                <Sparkles size={15} /> Review score {Math.round(latestQA.score * 100)}/100
              </div>
            ) : null}
          </div>
          {latestQA?.summary ? <p style={{ margin: '12px 0 0', fontSize: 13, color: textMuted, lineHeight: 1.55 }}>{latestQA.summary}</p> : null}
          {latestQA && latestQA.defects.filter((d) => d.action !== 'accept').length ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: textMuted }}>
              <div style={{ fontWeight: 700, color: accent, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={13} /> Open notes from the reviewer</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {latestQA.defects.filter((d) => d.action !== 'accept').slice(0, 5).map((d, i) => <li key={i}>{d.where}: {d.issue}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Failure */}
      {row.status === 'failed' ? (
        <div style={{ ...card, padding: 20, borderColor: 'var(--space-semantic-danger, #ef4444)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, color: 'var(--space-semantic-danger, #ef4444)' }}>
            <AlertTriangle size={17} /> The run could not finish
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13.5, color: textPrimary, lineHeight: 1.5 }}>{row.error || 'Unknown error.'}</p>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: textMuted }}>Completed stages are saved — fix the cause (e.g. wallet balance or file size) and start again; analysis and finished assets are reused where possible.</p>
        </div>
      ) : null}

      {/* Director's plan (optional transparency) */}
      {row.plan ? (
        <div style={{ ...card, padding: 20 }}>
          <button onClick={() => setShowPlan(!showPlan)} style={{ ...btnGhost, border: 'none', padding: 0 }}>
            <Eye size={15} /> {showPlan ? 'Hide' : 'See'} what the agent decided
          </button>
          {showPlan ? (
            <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
              {row.plan.direction ? <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: textPrimary }}><b style={{ color: accent }}>Director’s note:</b> {row.plan.direction}</p> : null}
              <div style={{ fontSize: 12.5, color: textMuted }}>
                {row.plan.timeline.length} segments · {row.plan.overlays.length} motion graphics · {row.plan.assets.length} generated assets
                {timing ? ' · ' + fmtClock(timing.duration) + ' planned cut' : ''}
                {' · captions ' + (row.plan.captions.enabled ? 'on (' + row.plan.captions.style.preset + ')' : 'off')}
                {row.plan.audio.music ? ' · scored' : ''}
              </div>
              <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 6 }}>
                {row.plan.timeline.map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '8px 12px', background: 'rgba(180,120,0,0.05)', borderRadius: 9 }}>
                    <span style={{ color: accent, fontWeight: 700, minWidth: 74, textTransform: 'uppercase', fontSize: 11 }}>{s.kind}</span>
                    <span style={{ color: textMuted }}>
                      {s.kind === 'source' && s.src ? fmtClock(s.src.start) + '–' + fmtClock(s.src.end) : (s.duration || 0).toFixed(1) + 's'}
                    </span>
                    <span style={{ flex: 1, color: textPrimary }}>{s.note || (s.kind === 'board' && s.board ? s.board.type : s.assetId || '')}</span>
                  </div>
                ))}
                {row.plan.overlays.map((o) => (
                  <div key={o.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '8px 12px', background: 'rgba(224,163,58,0.1)', borderRadius: 9 }}>
                    <span style={{ color: 'var(--space-text-accent, #E0A33A)', fontWeight: 700, minWidth: 74, fontSize: 11 }}>GRAPHIC</span>
                    <span style={{ color: textMuted }}>{fmtClock(o.at)} · {o.duration.toFixed(1)}s</span>
                    <span style={{ flex: 1, color: textPrimary }}>{o.spec.type}{o.note ? ' — ' + o.note : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Activity log */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: textMuted, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>Agent activity</div>
        <ActivityLog lines={row.activity || []} />
      </div>

      <style>{'@keyframes cine-spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }'}</style>
    </div>
  );
}

function ActivityLog({ lines }: { lines: ActivityLine[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [lines.length]);
  if (!lines.length) return <div style={{ fontSize: 13, color: textMuted }}>Waiting for the agent…</div>;
  return (
    <div style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 7, fontFamily: "'JetBrains Mono', Menlo, monospace", fontSize: 12 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, lineHeight: 1.5 }}>
          <span style={{ color: textMuted, flexShrink: 0 }}>{new Date(l.t).toLocaleTimeString()}</span>
          <span style={{
            color: l.kind === 'error' ? 'var(--space-semantic-danger, #ef4444)'
              : l.kind === 'warn' ? accent
              : l.kind === 'ok' ? 'var(--space-semantic-success-600, #34d399)'
              : textPrimary,
          }}>{l.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
