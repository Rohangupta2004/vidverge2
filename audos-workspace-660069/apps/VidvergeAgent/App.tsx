import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import VergerChat from './components/VergerChat';
import ProjectWorkspace from './components/ProjectWorkspace';
import ProjectQueue from './components/ProjectQueue';
import AgentActivity from './components/AgentActivity';
import HeygenRenderPanel from './components/HeygenRenderPanel';
import type { HeygenRenderState } from './components/HeygenRenderPanel';
import { getHeygenVideoStatus, heygenErrorMessage } from './lib/heygen';
import { IDLE_STATUS } from './types';
import type { AgentState, QueueJob } from './types';
import { openVidvergeStudio, saveVidvergeHandoff } from '../../lib/vidvergeHandoff';
import type { VidvergeAttachment } from '../../lib/vidvergeHandoff';
import VideoIntegrationPicker from '../../components/VideoIntegrationPicker';
import {
  loadVideoSelection,
  saveVideoSelection,
  type VideoIntegrationId,
} from '../../lib/videoIntegrations';
import AppShell from '../../components/ui/AppShell';
import { directorOwnerKey } from './lib/directorOwnerKey';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import { withBrandContext } from '../../components/BrandContextLayer';
import { loadPremadeVoices, setSoundPref, soundPref, speakReply, stopSpeaking } from './lib/vergerVoice';
import type { PremadeVoice } from './lib/vergerVoice';

/**
 * Verger aliases the shell's canonical amber tokens. The legacy `--vv-*`
 * names remain for its child components, while their values come directly
 * from config.json's `--vg-*` variables so shell and home can never drift.
 */
const TOKENS = {
  '--vv-bg': 'var(--vg-bg)',
  '--vv-surface': 'var(--vg-surface)',
  '--vv-surface-alt': 'var(--vg-raised)',
  '--vv-border': 'var(--vg-border)',
  '--vv-border-hover': 'var(--vg-control-border)',
  '--vv-gold': 'var(--vg-accent)',
  '--vv-gold-light': 'var(--vg-accent-hover)',
  '--vv-gold-glow': 'var(--vg-accent-soft)',
  '--vv-accent': 'var(--vg-accent)',
  '--vv-accent-light': 'var(--vg-accent-hover)',
  '--vv-text-dim': 'var(--vg-secondary)',
  '--vv-success': 'var(--vg-success)',
  '--vv-error': 'var(--vg-danger)',
} as unknown as CSSProperties;

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
const POLL_MS = 5000;
const HEYGEN_POLL_MS = 8000;
const HEYGEN_RENDER_TABLE = 'vv_heygen_renders';
const DIRECTOR_FILMS_TABLE = 'sf_director_films';

type LiveRow = Record<string, any>;
type JobState = QueueJob['state'];
type RowId = string | number;
type PersistedHeygenRenderState = HeygenRenderState & { recordId: RowId | null };

function rowId(row: LiveRow | null | undefined): RowId | null {
  return typeof row?.id === 'string' || typeof row?.id === 'number' ? row.id : null;
}

function responseRow(response: any): LiveRow | null {
  const data = response?.data;
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === 'object' ? data : null;
}

async function updateHeygenRender(
  recordId: RowId | null,
  videoId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const db = (window as any).__workspaceDb;
  if (!db?.from) return;
  let targetId = recordId;
  if (targetId === null) {
    const lookup = await db.from(HEYGEN_RENDER_TABLE).eq('video_id', videoId).limit(1).get();
    targetId = rowId(responseRow(lookup));
  }
  if (targetId !== null) await db.from(HEYGEN_RENDER_TABLE).update(targetId, changes);
}

function renderStateFromRow(row: LiveRow): PersistedHeygenRenderState {
  const createdAt = Date.parse(String(row.created_at || ''));
  return {
    recordId: rowId(row),
    phase: String(row.status).toLowerCase() === 'failed' ? 'failed' : String(row.status).toLowerCase() === 'completed' ? 'completed' : 'processing',
    videoId: String(row.video_id || ''),
    api: row.api_version === 'v2' ? 'v2' : 'v3',
    script: String(row.script || ''),
    avatarName: String(row.avatar_name || 'HeyGen character'),
    voiceName: String(row.voice_name || ''),
    videoUrl: String(row.video_url || ''),
    thumbnailUrl: String(row.thumbnail_url || ''),
    error: String(row.error_text || ''),
    startedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

async function loadRecoverableHeygenRender(): Promise<PersistedHeygenRenderState | null> {
  const db = (window as any).__workspaceDb;
  if (!db?.from) return null;
  const responses = await Promise.all(['processing', 'pending'].map((status) =>
    db.from(HEYGEN_RENDER_TABLE).eq('status', status).orderBy('updated_at', 'desc').limit(1).get(),
  ));
  const rows = responses
    .map(responseRow)
    .filter((row): row is LiveRow => Boolean(row?.video_id))
    .sort((a, b) => Date.parse(String(b.updated_at || '')) - Date.parse(String(a.updated_at || '')));
  return rows[0] ? renderStateFromRow(rows[0]) : null;
}

function prettyStage(value: unknown): string {
  const text = String(value || 'Queued').replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Queued';
}

function stateFrom(status: string, completed: string[], failed = ['failed', 'error'], active?: string[]): JobState {
  if (failed.includes(status)) return 'failed';
  if (completed.includes(status)) return 'completed';
  return active && !active.includes(status) ? 'waiting' : 'active';
}

function makeJob(
  source: string,
  row: LiveRow,
  appId: string,
  app: string,
  name: string,
  stage: string,
  state: JobState,
): QueueJob {
  const updatedAt = String(row.updated_at || row.created_at || '');
  const updatedMs = Date.parse(updatedAt);
  const liveState = state === 'active' && Number.isFinite(updatedMs) && Date.now() - updatedMs > 15 * 60 * 1000 ? 'waiting' : state;
  return {
    id: `${source}:${row.id}`,
    projectId: row.id,
    name: name || `${app} project`,
    stage,
    app,
    appId,
    state: liveState,
    updatedAt,
  };
}

function mapRows(table: string, rows: LiveRow[]): QueueJob[] {
  if (table === 'sceneforge_projects') return rows.map((row) => {
    const status = String(row.status || 'draft');
    return makeJob(table, row, 'sceneforge', 'SceneForge', String(row.topic || 'Untitled explainer'), prettyStage(row.stage_note || status), stateFrom(status, ['done'], ['failed', 'error'], ['scripting', 'avatar_render', 'scene_planning', 'asset_gen', 'coding', 'assembling', 'checks']));
  });
  if (table === 's2v_films') return rows.map((row) => {
    const status = String(row.status || 'draft');
    const machine = String(row.machine_state || row.stage_note || status);
    const activeMachines = ['SCRIPT_RECEIVED', 'ANALYZING_SCRIPT', 'SEGMENTING_SCRIPT', 'PREPARING_SCENE', 'GENERATING_VIDEO', 'VIDEO_COMPLETED', 'EXTRACTING_FINAL_FRAME', 'FRAME_READY', 'DETERMINE_NEXT_REFERENCE', 'PREPARE_NEXT_SCENE', 'ALL_SCENES_COMPLETED', 'AUDIO_PLANNING', 'AUDIO_GENERATING', 'AUDIO_READY', 'FFMPEG_ASSEMBLY'];
    const jobState: JobState = ['failed', 'error'].includes(status) ? 'failed' : status === 'ready' || machine === 'FINAL_VIDEO' ? 'completed' : activeMachines.includes(machine) ? 'active' : 'waiting';
    return makeJob(table, row, 'script-to-video', 'Script-to-Video', String(row.title || String(row.script || '').slice(0, 54) || 'Untitled film'), prettyStage(machine), jobState);
  });
  if (table === 'video_enhancements') return rows.map((row) => {
    const status = String(row.status || 'processing').toLowerCase();
    return makeJob(table, row, 'video-enhancer', 'Video Enhancer', String(row.title || 'Video enhancement'), prettyStage(status), stateFrom(status, ['completed'], ['failed', 'error'], ['pending', 'processing']));
  });
  if (table === DIRECTOR_FILMS_TABLE) return rows.map((row) => {
    const status = String(row.status || 'draft').toLowerCase();
    const stage = status === 'done'
      ? 'Ready to download'
      : status === 'failed'
        ? 'Failed'
        : status === 'narrating'
          ? 'HeyGen narration'
          : status === 'assets'
            ? 'Resolving scene images'
            : status === 'rendering'
              ? 'Remotion composition'
              : status === 'analyzing'
                ? 'Directing visuals'
                : 'Ready to direct';
    return {
      ...makeJob(DIRECTOR_FILMS_TABLE, row, 'sceneforge', 'SceneForge Director', String(row.title || String(row.script || '').slice(0, 54) || 'Untitled Director film'), stage, stateFrom(status, ['done'], ['failed'], ['analyzing', 'narrating', 'assets', 'rendering'])),
      surface: 'director' as const,
    };
  });
  if (table === HEYGEN_RENDER_TABLE) return rows.map((row) => {
    const status = String(row.status || 'pending').toLowerCase();
    const stage = status === 'completed'
      ? 'Ready to download'
      : status === 'failed'
        ? 'Render failed'
        : status === 'processing'
          ? 'HeyGen rendering'
          : 'Queued at HeyGen';
    const title = String(row.script || '').trim().replace(/\s+/g, ' ').slice(0, 54);
    return makeJob(table, row, 'vidverge-agent', 'HeyGen', title || String(row.avatar_name || 'HeyGen talking head'), stage, stateFrom(status, ['completed'], ['failed', 'error'], ['pending', 'processing']));
  });
  return [];
}

async function loadLiveJobs(directorKey = ''): Promise<QueueJob[]> {
  const db = (window as any).__workspaceDb;
  if (!db?.from) return [];
  const tables = ['sceneforge_projects', 's2v_films', 'video_enhancements', ...(directorKey ? [DIRECTOR_FILMS_TABLE] : []), HEYGEN_RENDER_TABLE];
  const results = await Promise.allSettled(tables.map(async (table) => {
    const source = table === DIRECTOR_FILMS_TABLE
      ? db.from(table, { shared: true }).eq('owner_key', directorKey)
      : db.from(table);
    const response = await source.orderBy('updated_at', 'desc').limit(8).get();
    return mapRows(table, Array.isArray(response?.data) ? response.data : []);
  }));
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'))
    .slice(0, 5);
}

function agentStatusFor(jobs: QueueJob[]): { state: AgentState; label: string } {
  const active = jobs.find((job) => job.state === 'active');
  if (!active) return { state: 'idle', label: IDLE_STATUS };
  const stage = active.stage.toLowerCase();
  if (/render|assembl|final|stitch/.test(stage)) return { state: 'working', label: 'Finalizing' };
  if (/edit|audio|voice|caption/.test(stage)) return { state: 'working', label: 'Editing' };
  if (/generat|asset|produc|film/.test(stage)) return { state: 'working', label: 'Generating' };
  return { state: 'working', label: 'Thinking...' };
}

async function uploadAttachment(file: File): Promise<VidvergeAttachment> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Attachments from the hub must be 50 MB or smaller.');
  const token = String((window as any).__workspaceDb?.token || '');
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('workspaceId', WORKSPACE_ID);
  form.append('folder', 'vidverge-agent-handoffs');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: token ? { 'X-Workspace-DB-Token': token } : undefined,
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) throw new Error(String(body?.error || `Attachment upload failed (${response.status}).`));
  return { url: String(body.url), name: file.name, type: file.type || 'application/octet-stream' };
}

function VergeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="vvAgentMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--vv-gold-light, #FFD16F)" />
          <stop offset="100%" stopColor="var(--vv-gold, #F2B544)" />
        </linearGradient>
      </defs>
      <path
        d="M3.6 4.8 L12 19.4 L20.4 4.8"
        stroke="url(#vvAgentMark)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.4 4.8 L12 11.2 L15.6 4.8"
        stroke="var(--vv-gold, #F2B544)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </svg>
  );
}

const BrandedVidvergeAgent = withBrandContext(App, 'Vidverge Agent');
export default BrandedVidvergeAgent;
function App() {
  const { subscription, subscriptionReady, sessionId, userRole } = useSpaceRuntime();
  const accountIdentity = subscriptionReady ? String(subscription?.email || sessionId || '') : '';
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [status, setStatus] = useState(IDLE_STATUS);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [activity, setActivity] = useState<string[]>(['Connecting to your studio queue…']);
  const [heygenRender, setHeygenRender] = useState<PersistedHeygenRenderState | null>(null);
  const [heygenRenderDismissed, setHeygenRenderDismissed] = useState(false);
  const [videoIntegration, setVideoIntegration] = useState<VideoIntegrationId>(() => loadVideoSelection().integration);
  const [videoModel, setVideoModel] = useState(() => loadVideoSelection().model);
  const [soundOn, setSoundOn] = useState(() => (typeof window === 'undefined' ? false : soundPref()));
  const [voices, setVoices] = useState<PremadeVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [projectContext, setProjectContext] = useState({ key: '', title: 'New video project' });
  const previousStates = useRef<Record<string, JobState>>({});
  const transitionReset = useRef<number | null>(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const voiceRef = useRef(voiceId);
  voiceRef.current = voiceId;

  useEffect(() => {
    let cancelled = false;
    const directorKey = accountIdentity ? directorOwnerKey(accountIdentity).catch(() => '') : Promise.resolve('');
    const refresh = async () => {
      const next = await loadLiveJobs(await directorKey);
      if (cancelled) return;
      setJobs(next);
      const previous = previousStates.current;
      const completed = next.find((job) => previous[job.id] === 'active' && job.state === 'completed');
      const failed = next.find((job) => previous[job.id] === 'active' && job.state === 'failed');
      previousStates.current = Object.fromEntries(next.map((job) => [job.id, job.state]));
      const live = agentStatusFor(next);
      if (completed || failed) {
        if (transitionReset.current) window.clearTimeout(transitionReset.current);
        setAgentState(completed ? 'completed' : 'error');
        setStatus(completed ? 'Completed' : 'Failed');
        transitionReset.current = window.setTimeout(() => {
          transitionReset.current = null;
          setAgentState(live.state);
          setStatus(live.label);
        }, 900);
      } else if (!transitionReset.current) {
        setAgentState(live.state);
        setStatus(live.label);
      }
      const active = next.filter((job) => job.state === 'active');
      setActivity(next.length
        ? [`Watching the queue · ${active.length} project${active.length === 1 ? '' : 's'} in flight`, ...next.slice(0, 3).map((job) => `${job.name} · ${job.stage.toLowerCase()}`)]
        : ['Queue connected · no recent projects']);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (transitionReset.current) window.clearTimeout(transitionReset.current);
    };
  }, [accountIdentity]);

  useEffect(() => {
    let cancelled = false;
    void loadRecoverableHeygenRender()
      .then((recovered) => {
        if (!cancelled && recovered) setHeygenRender((current) => current || recovered);
      })
      .catch((error) => console.warn('Could not restore the latest HeyGen render.', error));
    return () => { cancelled = true; };
  }, []);

  // Premade ElevenLabs voices load lazily, the first time sound is on.
  useEffect(() => {
    if (!soundOn || voices.length) return;
    let cancelled = false;
    void loadPremadeVoices()
      .then((loaded) => {
        if (cancelled || !loaded.length) return;
        setVoices(loaded);
        const preferred = loaded.find((voice) => /rachel|aria|sarah|adam/i.test(voice.name)) || loaded[0];
        setVoiceId((current) => current || preferred.id);
      })
      .catch((error) => console.warn('Premade voices could not be loaded.', error));
    return () => { cancelled = true; };
  }, [soundOn, voices.length]);

  // A HeyGen render that was in flight keeps its own polling clock; its ticket
  // and outcome live in WorkspaceDB so a reload resumes the same render.
  const renderPhase = heygenRender?.phase;
  const renderVideoId = heygenRender?.videoId || '';
  const renderApi = heygenRender?.api || 'v3';
  const renderRecordId = heygenRender?.recordId ?? null;
  useEffect(() => {
    if (renderPhase !== 'processing' || !renderVideoId) return;
    let cancelled = false;
    const ticket = { videoId: renderVideoId, api: renderApi };

    const check = async () => {
      try {
        const result = await getHeygenVideoStatus(ticket);
        const settled = result.status;
        if (cancelled || (settled !== 'completed' && settled !== 'failed')) return;
        try {
          await updateHeygenRender(renderRecordId, ticket.videoId, {
            status: settled,
            video_url: result.videoUrl || null,
            thumbnail_url: result.thumbnailUrl || null,
            error_text: result.error || null,
          });
        } catch (error) {
          console.warn('Could not persist the completed HeyGen render.', error);
        }
        if (cancelled) return;
        setHeygenRender((previous) => previous && previous.videoId === ticket.videoId
          ? {
            ...previous,
            phase: settled,
            videoUrl: result.videoUrl || previous.videoUrl,
            thumbnailUrl: result.thumbnailUrl || previous.thumbnailUrl,
            error: result.error,
          }
          : previous);
      } catch (error) {
        if (cancelled) return;
        // A transient proxy hiccup must not kill a render that is still going,
        // so only an unusable-credential verdict stops the poll.
        const message = heygenErrorMessage(error, '');
        if (!/not connected|rejected|not allowed/i.test(message)) return;
        try {
          await updateHeygenRender(renderRecordId, ticket.videoId, { status: 'failed', error_text: message });
        } catch (persistError) {
          console.warn('Could not persist the failed HeyGen render.', persistError);
        }
        if (cancelled) return;
        setHeygenRender((previous) => previous && previous.videoId === ticket.videoId
          ? { ...previous, phase: 'failed', error: message }
          : previous);
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), HEYGEN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [renderPhase, renderVideoId, renderApi, renderRecordId]);

  const speak = useCallback((text: string) => {
    if (!soundRef.current || !voiceRef.current) return;
    void speakReply(text, voiceRef.current).catch((error) => console.warn('Spoken reply failed.', error));
  }, []);

  const handleProjectChange = useCallback((key: string, title: string) => {
    setProjectContext((current) => current.key === key && current.title === title ? current : { key, title });
  }, []);

  const routeStudio = useCallback(
    (route: { appId: string; brief: string }, attachment: VidvergeAttachment | null) => {
      saveVideoSelection(videoIntegration, videoModel);
      saveVidvergeHandoff({ appId: route.appId, prompt: route.brief, attachment, videoIntegration, videoModel });
      openVidvergeStudio(route.appId);
    },
    [videoIntegration, videoModel],
  );

  function toggleSound() {
    setSoundOn((previous) => {
      const next = !previous;
      setSoundPref(next);
      if (!next) stopSpeaking();
      return next;
    });
  }

  function handleVideoProviderChange(integration: VideoIntegrationId, model: string) {
    setVideoIntegration(integration);
    setVideoModel(model);
    saveVideoSelection(integration, model);
  }

  function openJob(job: QueueJob) {
    saveVidvergeHandoff({ appId: job.appId, projectId: job.projectId, ...(job.surface ? { surface: job.surface } : {}) });
    openVidvergeStudio(job.appId);
  }

  const headerDot =
    agentState === 'working'
      ? 'var(--vv-gold)'
      : agentState === 'error'
        ? 'var(--vv-error)'
        : 'var(--vv-success)';
  const headerLabel =
    agentState === 'working' ? 'Agent working' : agentState === 'error' ? 'Agent failed' : 'Agent ready';

  return (
    <AppShell
      title="Vidverge"
      eyebrow="Verger · main agent"
      subtitle="Describe the outcome once. I plan it, run specialist agents in parallel, narrate each real step and ask only when a decision is needed."
      maxWidth={1180}
      watermark={false}
      style={{ ...TOKENS }}
      icon={(
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 38,
            height: 38,
            borderRadius: 12,
            background: 'var(--vg-accent-soft)',
            border: '1px solid var(--vv-border)',
            boxShadow: 'none',
          }}
        >
          <VergeMark />
        </span>
      )}
      actions={(
        <>
          <span className="flex items-center gap-2 rounded-full border border-[var(--vv-border)] bg-[var(--vv-surface)] px-3 py-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: headerDot,
                boxShadow: 'none',
              }}
            />
            <span className="text-[11px] text-[var(--vv-text-dim)]">{headerLabel}</span>
          </span>
          {soundOn && voices.length > 1 && (
            <select
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              className="h-8 max-w-[140px] rounded-full border border-[var(--vv-border)] bg-[var(--vv-surface)] px-2 text-[11px] text-[var(--vv-text-dim)] outline-none"
              aria-label="Premade voice for spoken replies"
              title="Premade ElevenLabs voice"
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={toggleSound}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--vv-border)] text-[var(--vv-text-dim)] transition-colors hover:border-[var(--vv-border-hover)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--space-text-primary)]"
            title={soundOn ? 'Sound on — replies are read aloud with a premade ElevenLabs voice' : 'Sound off — click to have Verger read replies aloud (premade ElevenLabs voices)'}
            aria-label={soundOn ? 'Turn spoken replies off' : 'Turn spoken replies on'}
          >
            {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </>
      )}
    >
      <main className="relative flex w-full flex-col justify-center pb-6">
        <div className="grid w-full items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <VergerChat
            jobs={jobs}
            onRouteStudio={routeStudio}
            onSpeak={speak}
            onUploadAttachment={uploadAttachment}
            onProjectChange={handleProjectChange}
          />
          {projectContext.key && <ProjectWorkspace projectKey={projectContext.key} projectTitle={projectContext.title} />}
        </div>

        <div className="mx-auto mt-4 w-full max-w-[1180px] space-y-3">
          {userRole === 'owner' && (
            <div className="rounded-2xl border border-[var(--vv-border)] bg-[color-mix(in_srgb,var(--vv-surface)_88%,transparent)] px-4 py-3">
              <VideoIntegrationPicker
                sceneOnly
                integration={videoIntegration}
                model={videoModel}
                onChange={handleVideoProviderChange}
                label="Video provider"
                note="Studios Verger opens inherit this integration and model for scene generation."
              />
            </div>
          )}

          {heygenRender && !heygenRenderDismissed && (
            <HeygenRenderPanel render={heygenRender} onDismiss={() => setHeygenRenderDismissed(true)} />
          )}
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ProjectQueue jobs={jobs} onOpen={openJob} />
          <div className="lg:pt-[28px]">
            <AgentActivity state={agentState} lines={activity} />
          </div>
        </div>
      </main>
    </AppShell>
  );
}
