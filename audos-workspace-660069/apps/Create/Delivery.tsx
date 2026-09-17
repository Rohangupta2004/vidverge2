/**
 * Live render room for the short-video pipeline.
 *
 * The generate-video backend persists one video_jobs row plus one video_clips
 * row per scene. This screen mirrors that structure directly: it resolves the
 * current persisted job, polls both tables every 2.5 seconds, and leaves the
 * storyboard visible after the assembled video is delivered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Film,
  Loader2,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  User,
} from 'lucide-react';
import VideoResultHero from '../../components/VideoResultHero';
import {
  canRetry,
  dismissJob,
  jobProgress,
  retryRender,
  startOverFresh,
  startOverFromLastVideo,
  useVideoStudio,
} from './videoStore';
import { pingVideoReconciler, regenerateClip } from './studioApi';
import { startSeries, useFrameChain } from './frameChain';
import { Card, ErrorNotice, GhostButton, ProgressBar, SeriesBadge, T } from './ui';

type DbClip = {
  id: number;
  job_id: string;
  clip_index: number;
  status: string;
  video_url?: string | null;
  first_frame_url?: string | null;
  last_frame_url?: string | null;
  generation_payload?: { prompt?: string } | null;
  fallback_reason?: string | null;
  qa_issues?: unknown;
  terminated_reason?: string | null;
};

type DbJob = {
  job_id: string;
  title?: string | null;
  status: string;
  video_url?: string | null;
  delivery_url?: string | null;
  error?: string | null;
  scene_count?: number | null;
  script_json?: unknown;
  /** Provider-reported render progress persisted by the watcher (0-100). */
  last_progress_value?: number | string | null;
  submitted_at?: string | null;
};

/** The visible status ladder: submitted → rendering → finishing → done/failed. */
type RenderStage = 'submitted' | 'rendering' | 'finishing' | 'done' | 'failed';

function StatusSteps({ stage }: { stage: RenderStage }) {
  const steps = [
    { key: 'submitted', label: 'Submitted' },
    { key: 'rendering', label: 'Rendering' },
    { key: 'finishing', label: 'Finishing' },
    { key: 'done', label: stage === 'failed' ? 'Failed' : 'Done' },
  ];
  const order = ['submitted', 'rendering', 'finishing', 'done'];
  const activeIndex = stage === 'failed' ? 3 : order.indexOf(stage);
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}
      data-testid="status-steps"
    >
      {steps.map((step, index) => {
        const isCurrent = index === activeIndex;
        const isDone = index < activeIndex || (stage === 'done' && index === 3);
        const isFailedNode = stage === 'failed' && index === 3;
        const color = isFailedNode ? T.danger : isDone ? T.success : isCurrent ? T.accentFg : T.muted;
        return (
          <span key={step.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {index > 0 ? (
              <span style={{ width: 18, height: 1, background: T.border, display: 'inline-block' }} />
            ) : null}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
              data-testid={`status-step-${step.key}`}
            >
              <span
                className={isCurrent && stage !== 'done' && stage !== 'failed' ? 'rc-pulse' : undefined}
                style={{ width: 7, height: 7, borderRadius: 999, background: color }}
              />
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

type ScriptScene = {
  description: string;
  narration: string;
};

type SceneStatus = 'queued' | 'generating' | 'done' | 'failed';

/**
 * Per-clip regeneration UI state — the visible status ladder the card shows:
 * 'Regenerating scene N…' → 'Polling…' → 'Done ✓', with an inline error and
 * a Retry button on failure instead of a silent stall.
 */
type RegenPhase = 'starting' | 'polling' | 'done' | 'failed';
interface RegenUiState {
  phase: RegenPhase;
  error?: string;
  startedAt: number;
  /** The clip was actually seen processing — guards against reading the
   * pre-regeneration 'completed' row as an instant success. */
  sawProcessing?: boolean;
}

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'partial']);

function rowsFromResponse<T>(payload: any): T[] {
  const candidates = [
    payload && payload.rows,
    payload && payload.data && payload.data.rows,
    payload && payload.data,
    payload && payload.result && payload.result.rows,
    payload && payload.results,
  ];
  const rows = candidates.find(Array.isArray);
  return (rows || []) as T[];
}

async function dbQuery<T>(query: string, params: unknown[]): Promise<T[]> {
  const ws = (window as any).__workspaceDb;
  if (!ws || !ws.workspaceId || !ws.token) {
    throw new Error('Live render tracking is unavailable in this session.');
  }
  const response = await fetch(`/api/workspaces/${ws.workspaceId}/db/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': ws.token,
    },
    body: JSON.stringify({ query, params }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || 'Could not refresh render progress.');
  }
  return rowsFromResponse<T>(payload);
}

function possibleJobId(job: unknown): string {
  const value = job as any;
  const keys = ['jobId', 'job_id', 'providerJobId', 'provider_job_id', 'remoteId', 'remote_id', 'id'];
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function parseScript(value: unknown): ScriptScene[] {
  let source: any = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(source)
    ? source
    : source && Array.isArray(source.scenes)
      ? source.scenes
      : [];
  return list.map((scene: any) => ({
    description: String(scene?.scene_description || scene?.description || scene?.visual || '').trim(),
    narration: String(scene?.narration || scene?.dialogue || scene?.voiceover || scene?.script || '').trim(),
  }));
}

function clipStatus(clip?: DbClip): SceneStatus {
  if (!clip) return 'queued';
  const status = String(clip.status || '').toLowerCase();
  if (status === 'completed') return 'done';
  if (status === 'failed' || status === 'terminated' || status === 'qa_flagged') return 'failed';
  if (status === 'processing' || status === 'generating') return 'generating';
  return 'queued';
}

function sceneError(clip?: DbClip): string {
  if (!clip || clipStatus(clip) !== 'failed') return '';
  if (clip.terminated_reason) return clip.terminated_reason;
  if (clip.fallback_reason) return clip.fallback_reason;
  if (Array.isArray(clip.qa_issues)) return clip.qa_issues.map(String).join(' · ');
  if (clip.qa_issues) return typeof clip.qa_issues === 'string' ? clip.qa_issues : JSON.stringify(clip.qa_issues);
  return 'This scene could not be generated.';
}

function StatusBadge({ status }: { status: SceneStatus }) {
  const meta = {
    queued: { color: T.muted, bg: 'rgba(148,163,184,0.12)' },
    generating: { color: T.accentFg, bg: T.accentSoft },
    done: { color: T.success, bg: 'rgba(74,222,128,0.12)' },
    failed: { color: T.danger, bg: 'rgba(239,68,68,0.12)' },
  }[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 999,
        color: meta.color,
        background: meta.bg,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.35,
        textTransform: 'uppercase',
      }}
      data-testid={`badge-scene-${status}`}
    >
      <span
        className={status === 'generating' ? 'rc-pulse' : undefined}
        style={{ width: 6, height: 6, borderRadius: 999, background: meta.color }}
      />
      {status}
    </span>
  );
}

function SceneCard({
  index,
  clip,
  script,
  aspect,
  canRegenerate,
  regen,
  onRegenerate,
}: {
  index: number;
  clip?: DbClip;
  script: ScriptScene;
  aspect: string;
  /** True once the whole job is terminal — the hook refuses mid-render regens. */
  canRegenerate?: boolean;
  regen?: RegenUiState;
  onRegenerate?: () => void;
}) {
  const status = clipStatus(clip);
  const error = sceneError(clip);
  const prompt = String(clip?.generation_payload?.prompt || '').trim();
  const description = script.description || prompt || 'Preparing this scene from your script…';
  const narration = script.narration;

  return (
    <Card
      className="rc-fade"
      style={{
        padding: 0,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderColor: status === 'failed' ? 'rgba(239,68,68,0.36)' : T.border,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))',
      }}
      data-testid={`card-live-scene-${index + 1}`}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: aspect === '9:16' ? '9 / 12' : '16 / 9',
          minHeight: 128,
          overflow: 'hidden',
          background: '#030812',
        }}
      >
        {clip?.video_url ? (
          <video
            src={clip.video_url}
            poster={clip.last_frame_url || clip.first_frame_url || undefined}
            muted
            playsInline
            preload="metadata"
            controls
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
            aria-label={`Scene ${index + 1} clip`}
            data-testid={`video-live-scene-${index + 1}`}
          />
        ) : clip?.last_frame_url ? (
          <img
            src={clip.last_frame_url}
            alt={`Scene ${index + 1} frame`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            className={status === 'failed' ? undefined : 'rc-skeleton'}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: status === 'failed' ? T.danger : T.muted,
              background: status === 'failed' ? 'rgba(239,68,68,0.06)' : undefined,
            }}
          >
            {status === 'failed' ? <AlertTriangle size={23} /> : <Film size={22} style={{ opacity: 0.42 }} />}
          </div>
        )}
        <span
          style={{
            position: 'absolute',
            top: 9,
            left: 9,
            padding: '4px 8px',
            borderRadius: 8,
            color: '#fff',
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(5px)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          Scene {index + 1}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 13, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ color: T.text, fontSize: 12.5, fontWeight: 700 }}>Shot {index + 1}</span>
          <StatusBadge status={status} />
        </div>
        <p
          style={{
            margin: 0,
            color: T.sub,
            fontSize: 12,
            lineHeight: 1.55,
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={description}
        >
          {description}
        </p>
        {narration ? (
          <p
            style={{
              margin: 'auto 0 0',
              paddingTop: 2,
              color: T.muted,
              fontSize: 11.5,
              fontStyle: 'italic',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            “{narration}”
          </p>
        ) : null}
        {error ? (
          <div
            style={{
              marginTop: 2,
              padding: '8px 9px',
              borderRadius: 8,
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.09)',
              fontSize: 11,
              lineHeight: 1.45,
              wordBreak: 'break-word',
            }}
            data-testid={`error-scene-${index + 1}`}
          >
            {error}
          </div>
        ) : null}
        {regen && regen.phase !== 'failed' ? (
          <div style={{ marginTop: 2 }} data-testid={`regen-status-scene-${index + 1}`}>
            {regen.phase !== 'done' ? (
              <ProgressBar
                value={
                  regen.phase === 'starting'
                    ? 0.12
                    : Math.min(0.92, 0.2 + (Date.now() - regen.startedAt) / 240000)
                }
                testId={`progress-regen-scene-${index + 1}`}
              />
            ) : null}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 6,
                fontSize: 11.5,
                fontWeight: 600,
                color: regen.phase === 'done' ? T.success : T.accentFg,
              }}
            >
              {regen.phase === 'done' ? <Check size={12} /> : <Loader2 size={12} className="rc-spin" />}
              {regen.phase === 'starting'
                ? `Regenerating scene ${index + 1}…`
                : regen.phase === 'polling'
                  ? 'Polling…'
                  : 'Done ✓'}
            </span>
          </div>
        ) : null}
        {regen && regen.phase === 'failed' ? (
          <div
            style={{
              marginTop: 2,
              padding: '8px 9px',
              borderRadius: 8,
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.09)',
              fontSize: 11,
              lineHeight: 1.45,
              wordBreak: 'break-word',
            }}
            data-testid={`regen-error-scene-${index + 1}`}
          >
            {regen.error || 'The scene could not be regenerated.'}
            <button
              type="button"
              className="rc-quiet rc-ring"
              onClick={onRegenerate}
              style={{ marginLeft: 8, minHeight: 24, padding: '2px 6px', color: '#fca5a5', fontWeight: 700 }}
              data-testid={`button-regen-retry-scene-${index + 1}`}
            >
              Retry
            </button>
          </div>
        ) : null}
        {onRegenerate &&
        canRegenerate &&
        clip &&
        (status === 'done' || status === 'failed') &&
        (!regen || regen.phase === 'done' || regen.phase === 'failed') ? (
          <button
            type="button"
            className="rc-ghost rc-ring rc-press"
            onClick={onRegenerate}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 2,
              minHeight: 34,
              padding: '7px 11px',
              borderRadius: 9,
              fontSize: 11.5,
              fontWeight: 600,
              color: T.sub,
              border: `1px solid ${T.border}`,
              background: 'transparent',
              cursor: 'pointer',
            }}
            data-testid={`button-regenerate-scene-${index + 1}`}
          >
            <RotateCcw size={12} /> Regenerate scene
          </button>
        ) : null}
      </div>
    </Card>
  );
}

function openVideosApp() {
  window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'videos' } }));
}

export default function Delivery() {
  const studio = useVideoStudio();
  const job = studio.job;
  const chain = useFrameChain();
  const [dbJob, setDbJob] = useState<DbJob | null>(null);
  const [clips, setClips] = useState<DbClip[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [regen, setRegen] = useState<Record<number, RegenUiState>>({});
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    if (!job) return;
    // Best-effort reconciler ping (self-throttled to ~60s inside the helper):
    // it re-polls any clip the provider has not been seen for 90s and enforces
    // the 15-minute no-output cap, so a dropped webhook never strands a render.
    void pingVideoReconciler();
    try {
      const candidate = possibleJobId(job);
      let jobs: DbJob[] = [];
      if (candidate) {
        jobs = await dbQuery<DbJob>(
          'SELECT job_id, title, status, video_url, delivery_url, error, scene_count, script_json, last_progress_value, submitted_at FROM video_jobs WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1',
          [candidate],
        );
      }
      if (!jobs.length) {
        const since = new Date(Math.max(0, job.startedAt - 30000)).toISOString();
        jobs = await dbQuery<DbJob>(
          'SELECT job_id, title, status, video_url, delivery_url, error, scene_count, script_json, last_progress_value, submitted_at FROM video_jobs WHERE title = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 1',
          [job.title, since],
        );
      }
      const current = jobs[0];
      if (!current?.job_id) return;
      setDbJob(current);
      const sceneRows = await dbQuery<DbClip>(
        'SELECT id, job_id, clip_index, status, video_url, first_frame_url, last_frame_url, generation_payload, fallback_reason, qa_issues, terminated_reason FROM video_clips WHERE job_id = $1 ORDER BY clip_index ASC',
        [current.job_id],
      );
      setClips(sceneRows);
      setPollError(null);
    } catch (error: any) {
      setPollError((error && error.message) || 'Could not refresh render progress.');
    }
  }, [job]);

  const localTerminal = !!job && (job.phase === 'ready' || job.phase === 'failed');
  const dbTerminal = !!dbJob && TERMINAL_JOB_STATUSES.has(String(dbJob.status || '').toLowerCase());

  useEffect(() => {
    if (!job) return;
    void refresh();
    if (dbTerminal) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [job, dbTerminal, refresh]);

  const regenActive = Object.values(regen).some(
    (entry) => entry.phase === 'starting' || entry.phase === 'polling',
  );

  useEffect(() => {
    if (!job || (localTerminal && !regenActive)) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [job, localTerminal, regenActive]);

  // The regeneration status ladder: 'Polling…' flips to 'Done ✓' only after
  // the clip has actually been SEEN processing and then completes — the stale
  // pre-regeneration 'completed' row must not read as an instant success.
  useEffect(() => {
    setRegen((current) => {
      let changed = false;
      const next: Record<number, RegenUiState> = { ...current };
      for (const clip of clips) {
        const entry = next[clip.id];
        if (!entry || entry.phase !== 'polling') continue;
        const status = clipStatus(clip);
        if (status === 'generating' && !entry.sawProcessing) {
          next[clip.id] = { ...entry, sawProcessing: true };
          changed = true;
        } else if (status === 'done' && entry.sawProcessing) {
          next[clip.id] = { phase: 'done', startedAt: entry.startedAt };
          changed = true;
        } else if (status === 'failed' && entry.sawProcessing) {
          next[clip.id] = {
            phase: 'failed',
            error: sceneError(clip) || 'The regeneration failed. Try it again.',
            startedAt: entry.startedAt,
          };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [clips]);

  const handleRegenerate = useCallback(
    async (clip: DbClip) => {
      const jobIdForClip = clip.job_id || (dbJob && dbJob.job_id) || '';
      if (!jobIdForClip) return;
      setRegen((current) => ({ ...current, [clip.id]: { phase: 'starting', startedAt: Date.now() } }));
      const result = await regenerateClip(jobIdForClip, clip.id);
      setRegen((current) => ({
        ...current,
        [clip.id]: result.success
          ? { phase: 'polling', startedAt: Date.now() }
          : { phase: 'failed', error: result.error, startedAt: Date.now() },
      }));
      if (result.success) void refresh();
    },
    [dbJob, refresh],
  );

  const persistedScript = useMemo(() => parseScript(dbJob?.script_json), [dbJob?.script_json]);
  const localScript = useMemo(
    () =>
      (studio.scenes || []).map((scene: any) => ({
        description: String(scene.description || '').trim(),
        narration: String(scene.dialogue || '').trim(),
      })),
    [studio.scenes],
  );
  const clipsByIndex = useMemo(() => {
    const map = new Map<number, DbClip>();
    clips.forEach((clip) => map.set(Number(clip.clip_index), clip));
    return map;
  }, [clips]);

  if (!job) {
    return (
      <div className="rc-glass rc-fade" style={{ width: '100%', maxWidth: 640, margin: 'clamp(24px, 8vh, 72px) auto 0', padding: 'clamp(24px, 5vw, 40px)', borderRadius: 16, textAlign: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 16, color: T.accentFg, border: `1px solid ${T.accentBorder}`, background: T.accentSoft }}>
          <Film size={23} />
        </span>
        <h1 style={{ margin: '16px 0 8px', color: T.text, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 700 }}>Ready when you are</h1>
        <p style={{ margin: '0 auto 18px', maxWidth: 440, color: T.sub, fontSize: 14, lineHeight: 1.6 }}>Start with a product URL or idea, then your generated video and live scene progress will appear here.</p>
        <GhostButton onClick={startOverFresh} testId="button-empty-start-video">Create a video</GhostButton>
      </div>
    );
  }

  const maxClipIndex = clips.reduce((max, clip) => Math.max(max, Number(clip.clip_index) || 0), -1);
  const totalScenes = Math.max(
    1,
    Number(dbJob?.scene_count) || 0,
    persistedScript.length,
    localScript.length,
    maxClipIndex + 1,
  );
  const sceneList = Array.from({ length: totalScenes }, (_, index) => ({
    index,
    clip: clipsByIndex.get(index),
    script: persistedScript[index] || localScript[index] || { description: '', narration: '' },
  }));
  const doneCount = sceneList.filter((scene) => clipStatus(scene.clip) === 'done').length;
  const failedCount = sceneList.filter((scene) => clipStatus(scene.clip) === 'failed').length;
  const percent = Math.round((doneCount / totalScenes) * 100);
  // Real backend progress: the watcher persists the provider's own progress
  // number on the job row (last_progress_value); blend it with scene
  // completion so the bar always shows the furthest truthful signal.
  const backendPercent =
    dbJob && dbJob.last_progress_value !== null && dbJob.last_progress_value !== undefined
      ? Math.max(0, Math.min(100, Math.round(Number(dbJob.last_progress_value) || 0)))
      : 0;
  const combinedPercent = Math.max(percent, backendPercent);
  const finalUrl = dbJob?.delivery_url || dbJob?.video_url || (job.phase === 'ready' ? job.downloadUrl : '');
  const wholeFailed = String(dbJob?.status || '').toLowerCase() === 'failed' || job.phase === 'failed';
  const elapsed = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const livePercent = dbJob ? combinedPercent : Math.round(jobProgress(job) * 100);
  const liveStatus = livePercent < 20 ? 'Scripting your video…' : livePercent < 80 ? 'Rendering scenes…' : 'Almost ready!';
  const jobStatusLower = String(dbJob?.status || '').toLowerCase();
  const renderStage: RenderStage = finalUrl
    ? 'done'
    : wholeFailed
      ? 'failed'
      : !dbJob || jobStatusLower === 'pending' || jobStatusLower === 'queued'
        ? 'submitted'
        : jobStatusLower === 'qa_review' || jobStatusLower === 'awaiting_approval' || (totalScenes > 0 && doneCount === totalScenes)
          ? 'finishing'
          : 'rendering';

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
      {finalUrl ? (
        <div className="rc-result-enter" style={{ marginBottom: 34 }}>
          <VideoResultHero
            src={finalUrl}
            aspect={job.aspect}
            title={job.title || 'Your video'}
            badge={job.restored ? 'Your last video' : 'Your video is ready'}
            note={
              job.audio === 'silent'
                ? 'Picture only — add your own music or voiceover wherever you post it.'
                : 'Playing muted — tap the speaker in the player for sound.'
            }
            stickyActions
            surface={T.bg}
            playerTestId="video-player-final"
            downloadTestId="link-download-video"
            actions={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {!chain.seriesActive && chain.lastCompletedFrame ? (
                  <GhostButton
                    onClick={startSeries}
                    testId="button-continue-series"
                    style={{ flex: '1 1 190px', borderColor: T.accentBorder, color: T.accentFg }}
                  >
                    <Repeat size={14} /> Continue as Series
                  </GhostButton>
                ) : null}
                {/* From a RESTORED result, Start over also forgets the saved
                    last video (vidverge_last_video) so the studio comes back
                    blank instead of re-showing it on the next visit. */}
                <GhostButton
                  onClick={job.restored ? startOverFromLastVideo : startOverFresh}
                  testId="button-make-another"
                  style={{ flex: '1 1 150px' }}
                >
                  <Plus size={14} /> Start over
                </GhostButton>
                <GhostButton
                  onClick={() => {
                    dismissJob();
                    openVideosApp();
                  }}
                  testId="link-my-videos"
                  style={{ flex: '1 1 130px' }}
                >
                  <Film size={13} /> My Videos
                </GhostButton>
              </div>
            }
          />
        </div>
      ) : null}

      <SeriesBadge style={{ marginBottom: 18 }} />

      {finalUrl && job.lastFrameUrl ? (
        <Card
          style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, padding: 11, maxWidth: 470 }}
          data-testid="card-last-frame-reference"
        >
          <img
            src={job.lastFrameUrl}
            alt="Extracted last frame of this video"
            style={{
              width: 54,
              height: 54,
              borderRadius: 10,
              objectFit: 'cover',
              background: '#000',
              border: `1px solid ${T.accentBorder}`,
            }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', color: T.text, fontSize: 12.5, fontWeight: 700 }}>
              Active character reference
            </span>
            <span style={{ display: 'block', marginTop: 3, color: T.sub, fontSize: 11.5, lineHeight: 1.5 }}>
              The last frame of this video — your next generation continues from this exact look
              {chain.seriesActive ? ' (series active)' : ''}.
            </span>
          </span>
        </Card>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 18,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              color: finalUrl ? T.success : wholeFailed ? T.danger : T.accentFg,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: 0.55,
              textTransform: 'uppercase',
            }}
          >
            {finalUrl ? <Check size={13} /> : wholeFailed ? <AlertTriangle size={13} /> : <Sparkles size={13} />}
            {finalUrl ? 'Final cut complete' : wholeFailed ? 'Render stopped' : 'Live render room'}
          </span>
          <h1 style={{ margin: '7px 0 6px', color: T.text, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 750, letterSpacing: -0.65 }}>
            {finalUrl ? 'Your scene storyboard' : wholeFailed ? 'The render stopped' : liveStatus}
          </h1>
          <p style={{ margin: 0, color: T.muted, fontSize: 13, lineHeight: 1.55 }}>
            {job.title} · {doneCount} of {totalScenes} scenes complete
            {!finalUrl && !wholeFailed ? ` · ${elapsedLabel} elapsed` : ''}
          </p>
        </div>
        {!finalUrl && !wholeFailed ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.sub, fontSize: 12.5 }}>
            <Loader2 size={14} className="rc-spin" color={T.accentFg} /> Live — updating every few seconds
          </span>
        ) : null}
      </div>

      <div style={{ marginBottom: 22 }}>
        <StatusSteps stage={renderStage} />
        <ProgressBar
          value={finalUrl ? 1 : dbJob ? combinedPercent / 100 : jobProgress(job)}
          stopped={wholeFailed}
          testId="progress-render-scenes"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7 }}>
          <span style={{ color: T.muted, fontSize: 11.5 }}>
            {doneCount} rendered · {Math.max(0, totalScenes - doneCount - failedCount)} remaining
          </span>
          <span style={{ color: failedCount ? T.danger : T.muted, fontSize: 11.5 }}>
            {failedCount ? `${failedCount} failed` : `${finalUrl ? 100 : combinedPercent}%`}
          </span>
        </div>
      </div>

      {studio.character?.imageUrl ? (
        <Card
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 22,
            padding: 11,
            maxWidth: 430,
            borderColor: T.accentBorder,
            background: T.accentSoft,
          }}
          data-testid="card-character-reference-active"
        >
          <img
            src={studio.character.imageUrl}
            alt={studio.character.name || 'Character reference'}
            style={{ width: 54, height: 54, borderRadius: 10, objectFit: 'cover', background: '#000' }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.text, fontSize: 12.5, fontWeight: 700 }}>
              <User size={13} color={T.accentFg} /> Character reference
            </span>
            <span style={{ display: 'block', marginTop: 3, color: T.sub, fontSize: 11.5 }}>
              {studio.character.name} — applied to all scenes
            </span>
          </span>
        </Card>
      ) : null}

      {pollError ? (
        <div style={{ marginBottom: 18 }}>
          <ErrorNotice>{pollError} The next refresh will retry automatically.</ErrorNotice>
        </div>
      ) : null}

      {wholeFailed ? (
        <Card
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
            borderColor: 'rgba(239,68,68,0.32)',
            background: 'rgba(239,68,68,0.055)',
          }}
          data-testid="card-job-failed"
        >
          <div style={{ flex: '1 1 280px' }}>
            <strong style={{ display: 'block', color: T.text, fontSize: 14, marginBottom: 5 }}>The video could not be completed</strong>
            <span style={{ color: T.sub, fontSize: 12.5, lineHeight: 1.55 }}>
              {dbJob?.error || job.error || 'The render pipeline stopped before the final video was assembled.'}
            </span>
          </div>
          <div className="rc-mobile-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}> 
            {canRetry() ? (
              <GhostButton onClick={retryRender} testId="button-retry-render">
                <RotateCcw size={14} /> Retry video
              </GhostButton>
            ) : null}
            <GhostButton onClick={dismissJob} testId="button-back-to-brief">Edit brief</GhostButton>
          </div>
        </Card>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))',
          gap: 14,
          alignItems: 'stretch',
        }}
        data-testid="grid-live-storyboard"
      >
        {sceneList.map((scene) => (
          <SceneCard
            key={scene.index}
            index={scene.index}
            clip={scene.clip}
            script={scene.script}
            aspect={job.aspect}
            canRegenerate={dbTerminal}
            regen={scene.clip ? regen[scene.clip.id] : undefined}
            onRegenerate={scene.clip ? () => void handleRegenerate(scene.clip as DbClip) : undefined}
          />
        ))}
      </div>

      {!finalUrl && !wholeFailed ? (
        <p style={{ margin: '20px 0 0', color: T.muted, fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
          You can leave this screen while it renders. Return any time to see each finished scene and the final cut.
        </p>
      ) : null}
    </div>
  );
}
