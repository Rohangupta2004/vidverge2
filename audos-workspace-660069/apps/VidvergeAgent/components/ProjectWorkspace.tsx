import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Film,
  History,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { listVideoHistory, type VideoHistoryRow } from '../../../lib/videoHistory';
import {
  appendProjectSnapshot,
  loadProjectSnapshot,
  type VergerProject,
  type VergerScene,
  type VergerSceneVersion,
} from '../lib/vergerStore';
import {
  applyPreparedVisualEdit,
  classifyMediaError,
  resumePreparedVisualEdit,
  OMNI_EDIT_CREDITS,
  prepareVisualEdit,
  type EditProgress,
  type PreparedVisualEdit,
} from '../lib/vergerMedia';

interface ProjectWorkspaceProps {
  projectKey: string;
  projectTitle: string;
}

function key(prefix: string): string {
  const value = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${value}`;
}

function newProject(projectKey: string, title: string): VergerProject {
  return {
    id: projectKey,
    title: title || 'New video project',
    script: '',
    scenes: [],
    assets: [],
    renders: [],
    runLog: [],
    editHistory: [],
    updatedAt: new Date().toISOString(),
  };
}

function firstVersion(video: VideoHistoryRow): VergerSceneVersion {
  return {
    id: `history:${video.id}`,
    videoUrl: video.video_url,
    label: 'Original render',
    createdAt: video.created_at || new Date().toISOString(),
  };
}

function sceneForVideo(video: VideoHistoryRow, duration: number): VergerScene {
  const version = firstVersion(video);
  return {
    id: `scene:${video.id}`,
    label: video.title || 'Scene 1',
    startSec: 0,
    endSec: duration || video.duration_sec || 8,
    activeVersionId: version.id,
    versions: [version],
  };
}

function activeVersion(scene: VergerScene | null): VergerSceneVersion | null {
  if (!scene) return null;
  return scene.versions.find((version) => version.id === scene.activeVersionId) || scene.versions[scene.versions.length - 1] || null;
}

function errorExplanation(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The edit could not be completed.';
  const category = classifyMediaError(message, Number((error as any)?.status || 0));
  const lead: Record<string, string> = {
    auth: 'Your signed-in workspace session could not authorize this step.',
    credits: 'The workspace does not have enough credits for this paid edit.',
    provider_rejection: 'Omni Flash rejected this specific edit request.',
    format: 'The source clip or parameters are outside Omni Flash’s accepted video-input contract.',
    timeout: 'The provider did not finish within the bounded wait.',
    bad_prompt: 'The edit instruction was not specific enough for a safe targeted change.',
    unknown: 'A media step failed before the edited version was ready.',
  };
  return `${lead[category]} ${message} No automatic paid retry was made.`;
}

export default function ProjectWorkspace({ projectKey, projectTitle }: ProjectWorkspaceProps) {
  const [project, setProject] = useState<VergerProject>(() => newProject(projectKey, projectTitle));
  const [videos, setVideos] = useState<VideoHistoryRow[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [duration, setDuration] = useState(0);
  const [timestamp, setTimestamp] = useState(0);
  const [request, setRequest] = useState('');
  const [prepared, setPrepared] = useState<PreparedVisualEdit | null>(null);
  const [prompt, setPrompt] = useState('');
  const [progress, setProgress] = useState<EditProgress>({ phase: 'idle', agent: 'Verger', detail: 'Select a finished video to preview or edit.' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const selectedScene = useMemo(
    () => project.scenes.find((scene) => scene.id === selectedSceneId) || project.scenes[0] || null,
    [project.scenes, selectedSceneId],
  );
  const version = activeVersion(selectedScene);

  async function persist(next: VergerProject): Promise<void> {
    const stamped = { ...next, title: projectTitle || next.title, updatedAt: new Date().toISOString() };
    projectRef.current = stamped;
    setProject(stamped);
    await appendProjectSnapshot(projectKey, projectTitle || stamped.title, stamped);
  }

  function logStep(step: EditProgress): void {
    setProgress(step);
    const current = projectRef.current;
    const next: VergerProject = {
      ...current,
      runLog: [...current.runLog, {
        id: key('log'),
        agent: step.agent,
        status: step.phase,
        detail: step.detail,
        createdAt: new Date().toISOString(),
      }].slice(-80),
    };
    void persist(next);
  }

  async function commitEditOutcome(
    outcome: { videoUrl: string; editedClipUrl: string; operationId: string },
    preparedEdit: PreparedVisualEdit,
    sceneId: string,
    sourceVersionId: string,
    approvedPrompt: string,
  ): Promise<void> {
    const current = projectRef.current;
    if (current.renders.some((render) => render.id === outcome.operationId)) return;
    const createdAt = new Date().toISOString();
    const nextVersion: VergerSceneVersion = {
      id: key('version'),
      videoUrl: outcome.videoUrl,
      label: `Visual edit at ${preparedEdit.window.timestampSec.toFixed(2)}s`,
      createdAt,
      sourceVersionId,
      editPrompt: approvedPrompt,
      editWindow: preparedEdit.window,
    };
    await persist({
      ...current,
      pendingOperation: undefined,
      scenes: current.scenes.map((scene) => scene.id === sceneId
        ? { ...scene, activeVersionId: nextVersion.id, versions: [...scene.versions, nextVersion] }
        : scene),
      renders: [...current.renders, { id: outcome.operationId, url: outcome.videoUrl, label: nextVersion.label, createdAt }],
      editHistory: [...current.editHistory, {
        id: key('edit'),
        sceneId,
        fromVersionId: sourceVersionId,
        toVersionId: nextVersion.id,
        request: preparedEdit.request,
        createdAt,
      }],
    });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadProjectSnapshot(projectKey), listVideoHistory(20)])
      .then(([saved, history]) => {
        if (cancelled) return;
        const restored = saved || newProject(projectKey, projectTitle);
        setVideos(history);
        if (!restored.scenes.length && history[0]) {
          restored.scenes = [sceneForVideo(history[0], Number(history[0].duration_sec || 0))];
          restored.renders = [{ id: String(history[0].id), url: history[0].video_url, label: history[0].title, createdAt: history[0].created_at }];
          void persist(restored);
        } else {
          projectRef.current = restored;
          setProject(restored);
        }
        setSelectedSceneId(restored.pendingOperation?.sceneId || restored.scenes[0]?.id || '');
        if (restored.pendingOperation) {
          const pending = restored.pendingOperation;
          setBusy(true);
          void resumePreparedVisualEdit(pending.prepared, pending.operationId, logStep)
            .then((outcome) => commitEditOutcome(outcome, pending.prepared, pending.sceneId, pending.sourceVersionId, pending.prompt))
            .catch((resumeError) => {
              const message = errorExplanation(resumeError);
              setError(message);
              logStep({ phase: 'failed', agent: 'QA & Error Agent', detail: message });
              if (classifyMediaError(message, Number((resumeError as any)?.status || 0)) !== 'timeout') {
                void persist({ ...projectRef.current, pendingOperation: undefined });
              }
            })
            .finally(() => setBusy(false));
        }
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Project preview could not be restored.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectKey]);

  useEffect(() => {
    setPrepared(null);
    setPrompt('');
    setTimestamp(selectedScene?.startSec || 0);
    setProgress({ phase: 'idle', agent: 'Verger', detail: selectedScene ? 'Scene selected. Scrub to the exact moment you want changed.' : 'Select a finished video to begin.' });
  }, [selectedSceneId]);

  async function addHistoryVideo(video: VideoHistoryRow): Promise<void> {
    const current = projectRef.current;
    const existing = current.scenes.find((scene) => scene.versions.some((item) => item.videoUrl === video.video_url));
    if (existing) {
      setSelectedSceneId(existing.id);
      return;
    }
    const scene = sceneForVideo(video, Number(video.duration_sec || 0));
    await persist({
      ...current,
      scenes: [...current.scenes, scene],
      renders: [...current.renders, { id: String(video.id), url: video.video_url, label: video.title, createdAt: video.created_at }],
    });
    setSelectedSceneId(scene.id);
  }

  function captureTimestamp(): void {
    const point = Math.round(Number(videoRef.current?.currentTime || timestamp) * 100) / 100;
    setTimestamp(point);
    setPrepared(null);
    setPrompt('');
  }

  function putSelectionInChat(): void {
    const detail = {
      sceneId: selectedScene?.id || '',
      sceneLabel: selectedScene?.label || 'selected scene',
      timestampSec: timestamp,
      videoUrl: version?.videoUrl || '',
    };
    window.dispatchEvent(new CustomEvent('verger-video-context', { detail }));
  }

  async function prepare(
    requestOverride?: string,
    timestampOverride?: number,
    sceneOverride?: VergerScene,
  ): Promise<void> {
    const targetScene = sceneOverride || selectedScene;
    const targetVersion = activeVersion(targetScene || null);
    const change = String(requestOverride ?? request).trim();
    const point = Number.isFinite(Number(timestampOverride)) ? Number(timestampOverride) : timestamp;
    if (!targetVersion || !targetScene || !change) return;
    setError('');
    setBusy(true);
    try {
      const sourceDuration = duration || targetScene.endSec || 8;
      const result = await prepareVisualEdit(targetVersion.videoUrl, sourceDuration, point, change, logStep);
      setPrepared(result);
      setPrompt(result.prompt);
    } catch (prepareError) {
      const message = errorExplanation(prepareError);
      setError(message);
      logStep({ phase: 'failed', agent: 'QA & Error Agent', detail: message });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const requestedEdit = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const change = String(detail.request || '').trim();
      if (!change || busy) return;
      const sceneText = String(detail.sceneReference || '').toLowerCase();
      const ordinal = Number(sceneText.match(/(?:scene|shot)\s*(\d+)/)?.[1] || 0);
      const target = ordinal > 0 ? projectRef.current.scenes[ordinal - 1] : selectedScene;
      if (!target) {
        setError('There is no finished scene in this project to edit yet.');
        return;
      }
      setSelectedSceneId(target.id);
      const point = detail.timestampSec != null && Number.isFinite(Number(detail.timestampSec)) ? Number(detail.timestampSec) : timestamp;
      setTimestamp(point);
      setRequest(change);
      setPrepared(null);
      setPrompt('');
      void prepare(change, point, target);
    };
    window.addEventListener('verger-request-visual-edit', requestedEdit);
    return () => window.removeEventListener('verger-request-visual-edit', requestedEdit);
  }, [busy, duration, selectedScene?.id, timestamp, request]);

  async function approveAndEdit(): Promise<void> {
    if (!prepared || !selectedScene || !version || !prompt.trim()) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    try {
      const outcome = await applyPreparedVisualEdit(
        prepared,
        prompt.trim(),
        logStep,
        async (operationId) => {
          await persist({
            ...projectRef.current,
            pendingOperation: {
              operationId,
              sceneId: selectedScene.id,
              sourceVersionId: version.id,
              prompt: prompt.trim(),
              prepared,
              startedAt: new Date().toISOString(),
            },
          });
        },
        controller.signal,
      );
      await commitEditOutcome(outcome, prepared, selectedScene.id, version.id, prompt.trim());
      setPrepared(null);
      setPrompt('');
      setRequest('');
    } catch (editError) {
      const message = errorExplanation(editError);
      setError(message);
      logStep({ phase: 'failed', agent: 'QA & Error Agent', detail: message });
      if (classifyMediaError(message, Number((editError as any)?.status || 0)) !== 'timeout' && projectRef.current.pendingOperation) {
        await persist({ ...projectRef.current, pendingOperation: undefined });
      }
    } finally {
      setBusy(false);
    }
  }

  async function activateVersion(versionId: string): Promise<void> {
    if (!selectedScene) return;
    await persist({
      ...projectRef.current,
      scenes: projectRef.current.scenes.map((scene) => scene.id === selectedScene.id ? { ...scene, activeVersionId: versionId } : scene),
    });
    setPrepared(null);
    setPrompt('');
  }

  const phaseTone = progress.phase === 'failed' ? 'var(--vg-danger)' : progress.phase === 'completed' ? 'var(--vg-success)' : 'var(--vg-accent)';

  return (
    <aside className="min-w-0 rounded-2xl border border-[var(--vg-border)] bg-[var(--vg-surface)] p-3 lg:sticky lg:top-4 lg:self-start">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--vg-accent)]"><Film size={12} /> Live project</p>
          <h2 className="mt-1 truncate text-[15px] font-semibold text-[var(--vg-text)]">{projectTitle || project.title}</h2>
          <p className="text-[10px] text-[var(--vg-muted)]">{project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} · {project.editHistory.length} edit{project.editHistory.length === 1 ? '' : 's'}</p>
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-[var(--vg-accent)]" />}
      </div>

      {videos.length > 0 && (
        <label className="mb-3 block text-[10px] font-medium uppercase tracking-wide text-[var(--vg-muted)]">
          Add a finished render
          <select
            defaultValue=""
            onChange={(event) => {
              const video = videos.find((item) => item.id === event.target.value);
              if (video) void addHistoryVideo(video);
              event.target.value = '';
            }}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--vg-border)] bg-[var(--vg-raised)] px-2 text-[11px] normal-case tracking-normal text-[var(--vg-secondary)] outline-none"
          >
            <option value="">Choose from My Videos…</option>
            {videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
          </select>
        </label>
      )}

      {version ? (
        <>
          <div className="overflow-hidden rounded-xl border border-[var(--vg-border)] bg-black">
            <video
              ref={videoRef}
              key={version.videoUrl}
              src={version.videoUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const seconds = Number(event.currentTarget.duration || 0);
                if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
              }}
              onTimeUpdate={(event) => setTimestamp(Math.round(event.currentTarget.currentTime * 100) / 100)}
              className="aspect-video w-full object-contain"
            />
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--vg-muted)]">
              <span>Timeline</span><span className="tabular-nums">{timestamp.toFixed(2)}s / {(duration || selectedScene?.endSec || 0).toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0.01, duration || selectedScene?.endSec || 8)}
              step={0.01}
              value={Math.min(timestamp, Math.max(0.01, duration || selectedScene?.endSec || 8))}
              onChange={(event) => {
                const value = Number(event.target.value);
                setTimestamp(value);
                if (videoRef.current) videoRef.current.currentTime = value;
              }}
              className="w-full accent-[var(--vg-accent)]"
              aria-label="Select exact edit timestamp"
            />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={captureTimestamp} className="flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--vg-border)] text-[10px] font-medium text-[var(--vg-secondary)] hover:bg-[var(--vg-hover)]"><Clock3 size={11} /> Use {timestamp.toFixed(2)}s</button>
              <button type="button" onClick={putSelectionInChat} className="flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--vg-border)] text-[10px] font-medium text-[var(--vg-secondary)] hover:bg-[var(--vg-hover)]"><MessageSquare size={11} /> Mention in chat</button>
            </div>
          </div>

          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {project.scenes.map((scene, index) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => setSelectedSceneId(scene.id)}
                className={`min-w-[96px] rounded-lg border px-2 py-2 text-left ${scene.id === selectedScene?.id ? 'border-[var(--vg-accent)] bg-[var(--vg-accent-soft)]' : 'border-[var(--vg-border)] bg-[var(--vg-raised)]'}`}
              >
                <span className="block text-[9px] uppercase tracking-wide text-[var(--vg-muted)]">Scene {index + 1}</span>
                <span className="mt-0.5 block truncate text-[10px] font-medium text-[var(--vg-text)]">{scene.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-[var(--vg-border)] bg-[var(--vg-raised)] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--vg-text)]"><Scissors size={12} className="text-[var(--vg-accent)]" /> Vision-guided Omni edit</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--vg-muted)]">Verger trims only an 8-second window, analyses sampled frames, then shows the precise prompt before spending.</p>
            <textarea
              value={request}
              onChange={(event) => { setRequest(event.target.value); setPrepared(null); setPrompt(''); }}
              placeholder="At this moment, make the product reveal punchier but keep the person, camera, background and audio unchanged."
              className="mt-2 min-h-[70px] w-full resize-y rounded-lg border border-[var(--vg-border)] bg-[var(--vg-surface)] p-2 text-[11px] leading-relaxed text-[var(--vg-text)] outline-none placeholder:text-[var(--vg-muted)] focus:border-[var(--vg-control-border)]"
            />
            {!prepared ? (
              <button
                type="button"
                onClick={() => void prepare()}
                disabled={busy || !request.trim()}
                className="mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--vg-accent)_45%,transparent)] bg-[var(--vg-accent-soft)] text-[11px] font-semibold text-[var(--vg-accent)] disabled:opacity-40"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Analyse frames & write prompt · free
              </button>
            ) : (
              <>
                <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-[var(--vg-muted)]">
                  Detailed prompt · review or edit
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="mt-1 min-h-[130px] w-full resize-y rounded-lg border border-[var(--vg-border)] bg-[var(--vg-surface)] p-2 text-[10px] normal-case leading-relaxed tracking-normal text-[var(--vg-secondary)] outline-none focus:border-[var(--vg-control-border)]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void approveAndEdit()}
                  disabled={busy || prompt.trim().length < 80}
                  className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold text-[var(--vg-on-accent)] disabled:opacity-40"
                  style={{ background: 'var(--vg-gradient-action)' }}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />} Approve & edit · {OMNI_EDIT_CREDITS} credits
                </button>
              </>
            )}
          </div>

          <div className="mt-3 rounded-xl border border-[var(--vg-border)] bg-[var(--vg-raised)] p-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: phaseTone }}>
              {progress.phase === 'failed' ? <AlertCircle size={11} /> : progress.phase === 'completed' ? <CheckCircle2 size={11} /> : busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {progress.agent}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--vg-secondary)]">{progress.detail}</p>
          </div>

          {error && <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--vg-danger)_45%,transparent)] bg-[var(--vg-danger-bg)] p-2 text-[10px] leading-relaxed text-[var(--vg-danger)]">{error}</p>}

          {selectedScene && selectedScene.versions.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--vg-muted)]"><History size={11} /> Scene versions</p>
              <div className="space-y-1">
                {[...selectedScene.versions].reverse().map((item) => {
                  const current = item.id === selectedScene.activeVersionId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void activateVersion(item.id)}
                      className={`flex min-h-9 w-full items-center gap-2 rounded-lg border px-2 text-left ${current ? 'border-[color-mix(in_srgb,var(--vg-success)_50%,transparent)] bg-[color-mix(in_srgb,var(--vg-success)_9%,transparent)]' : 'border-[var(--vg-border)] bg-[var(--vg-raised)] hover:bg-[var(--vg-hover)]'}`}
                    >
                      {current ? <CheckCircle2 size={11} className="text-[var(--vg-success)]" /> : <RotateCcw size={11} className="text-[var(--vg-muted)]" />}
                      <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--vg-secondary)]">{item.label}</span>
                      <span className="text-[9px] text-[var(--vg-muted)]">{current ? 'Active' : 'Revert'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--vg-border)] px-4 py-8 text-center">
          <Film size={24} className="mx-auto text-[var(--vg-muted)]" />
          <p className="mt-2 text-[12px] font-medium text-[var(--vg-text)]">No render in this project yet</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--vg-muted)]">Ask Verger to make a video, or add one from My Videos when it finishes.</p>
        </div>
      )}
    </aside>
  );
}
