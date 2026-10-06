import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Mic, User, Volume2, Zap, ZapOff } from 'lucide-react';
import AgentCanvas from './components/AgentCanvas';
import CreateBar from './components/CreateBar';
import ProjectQueue from './components/ProjectQueue';
import AgentActivity from './components/AgentActivity';
import HeygenSection from './components/HeygenSection';
import HeygenAvatarPicker from './components/HeygenAvatarPicker';
import HeygenVoicePicker from './components/HeygenVoicePicker';
import HeygenRenderPanel from './components/HeygenRenderPanel';
import type { HeygenRenderState } from './components/HeygenRenderPanel';
import { createHeygenVideo, getHeygenVideoStatus, heygenErrorMessage } from './lib/heygen';
import type { HeygenAvatar, HeygenRenderTicket, HeygenVoice } from './lib/heygen';
import { IDLE_STATUS, TARGET_APPS } from './types';
import type { AgentState, QueueJob } from './types';
import { openVidvergeStudio, saveVidvergeHandoff } from '../../lib/vidvergeHandoff';
import VideoIntegrationPicker from '../../components/VideoIntegrationPicker';
import {
  loadVideoSelection,
  saveVideoSelection,
  type VideoIntegrationId,
} from '../../lib/videoIntegrations';

/**
 * Local palette for the agent hub. The gold is inherited from the space brand
 * token so the hub stays in sync with the shell; the literals are fallbacks.
 */
const TOKENS = {
  '--vv-bg': '#08080f',
  '--vv-surface': '#111118',
  '--vv-border': 'rgba(255,255,255,0.06)',
  '--vv-gold': 'var(--space-brand-primary-500, #F5A623)',
  '--vv-gold-light': '#FFD9A0',
  '--vv-gold-glow': 'rgba(245,166,35,0.4)',
  '--vv-text-dim': 'rgba(255,255,255,0.5)',
  '--vv-success': '#4ade80',
  '--vv-error': '#f97316',
} as unknown as CSSProperties;

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
const POLL_MS = 5000;
const HEYGEN_POLL_MS = 8000;
const HEYGEN_RENDER_TABLE = 'vv_heygen_renders';

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

async function insertHeygenRender(input: {
  videoId: string;
  apiVersion: 'v2' | 'v3';
  script: string;
  avatarId: string;
  avatarName: string;
  voiceId: string;
  voiceName: string;
}): Promise<RowId | null> {
  const db = (window as any).__workspaceDb;
  if (!db?.from) throw new Error('WorkspaceDB is unavailable.');
  const table = db.from(HEYGEN_RENDER_TABLE);
  const response = await table.insert({
    video_id: input.videoId,
    api_version: input.apiVersion,
    script: input.script,
    avatar_id: input.avatarId,
    avatar_name: input.avatarName,
    voice_id: input.voiceId || null,
    voice_name: input.voiceName || null,
    status: 'processing',
    video_url: null,
    thumbnail_url: null,
    error_text: null,
  });
  const insertedId = rowId(responseRow(response));
  if (insertedId !== null) return insertedId;
  const lookup = await db.from(HEYGEN_RENDER_TABLE).eq('video_id', input.videoId).limit(1).get();
  return rowId(responseRow(lookup));
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
  progress: number,
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
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    app,
    appId,
    state: liveState,
    updatedAt,
  };
}

const SF_PROGRESS: Record<string, number> = { draft: 0, scripting: 10, script_review: 22, avatar_render: 36, style_choice: 45, scene_planning: 54, scene_review: 62, asset_gen: 72, coding: 80, assembling: 91, checks: 96, editing: 98, done: 100 };
const FC_PROGRESS: Record<string, number> = { pending: 3, researching: 12, scripting: 28, prompting: 42, generating: 70, stitching: 92, done: 100, failed: 100 };
const S2V_PROGRESS: Record<string, number> = { draft: 3, planning: 14, plan_ready: 25, producing: 62, assembling: 91, ready: 100, error: 100 };
const S2V_MACHINE_PROGRESS: Record<string, number> = { SCRIPT_RECEIVED: 4, ANALYZING_SCRIPT: 10, SEGMENTING_SCRIPT: 16, PREPARING_SCENE: 28, PROMPT_READY: 34, GENERATING_VIDEO: 58, VIDEO_COMPLETED: 68, EXTRACTING_FINAL_FRAME: 72, FRAME_READY: 76, DETERMINE_NEXT_REFERENCE: 79, PREPARE_NEXT_SCENE: 82, ALL_SCENES_COMPLETED: 85, AUDIO_PLANNING: 87, AUDIO_GENERATING: 90, AUDIO_READY: 93, FFMPEG_ASSEMBLY: 96, FINAL_VIDEO: 100 };
const SV_PROGRESS: Record<string, number> = { analyzing: 10, identity_ready: 20, scripting: 38, building: 66, rendering: 90, completed: 100, failed: 100 };

function mapRows(table: string, rows: LiveRow[]): QueueJob[] {
  if (table === 'sceneforge_projects') return rows.map((row) => {
    const status = String(row.status || 'draft');
    const assembly = row.assembly_job && typeof row.assembly_job === 'object' ? Number(row.assembly_job.progress) : NaN;
    return makeJob(table, row, 'sceneforge', 'SceneForge', String(row.topic || 'Untitled explainer'), prettyStage(row.stage_note || status), Number.isFinite(assembly) && ['assembling', 'checks'].includes(status) ? assembly : (SF_PROGRESS[status] ?? 5), stateFrom(status, ['done'], ['failed', 'error'], ['scripting', 'avatar_render', 'scene_planning', 'asset_gen', 'coding', 'assembling', 'checks']));
  });
  if (table === 'fc_projects') return rows.map((row) => {
    const status = String(row.status || 'pending');
    return makeJob(table, row, 'faceless-content', 'Faceless Content', String(row.topic || 'Untitled faceless video'), prettyStage(row.stage || status), FC_PROGRESS[status] ?? 5, stateFrom(status, ['done']));
  });
  if (table === 's2v_films') return rows.map((row) => {
    const status = String(row.status || 'draft');
    const machine = String(row.machine_state || row.stage_note || status);
    const activeMachines = ['SCRIPT_RECEIVED', 'ANALYZING_SCRIPT', 'SEGMENTING_SCRIPT', 'PREPARING_SCENE', 'GENERATING_VIDEO', 'VIDEO_COMPLETED', 'EXTRACTING_FINAL_FRAME', 'FRAME_READY', 'DETERMINE_NEXT_REFERENCE', 'PREPARE_NEXT_SCENE', 'ALL_SCENES_COMPLETED', 'AUDIO_PLANNING', 'AUDIO_GENERATING', 'AUDIO_READY', 'FFMPEG_ASSEMBLY'];
    const jobState: JobState = ['failed', 'error'].includes(status) ? 'failed' : status === 'ready' || machine === 'FINAL_VIDEO' ? 'completed' : activeMachines.includes(machine) ? 'active' : 'waiting';
    return makeJob(table, row, 'script-to-video', 'Script-to-Video', String(row.title || String(row.script || '').slice(0, 54) || 'Untitled film'), prettyStage(machine), S2V_MACHINE_PROGRESS[machine] ?? S2V_PROGRESS[status] ?? 5, jobState);
  });
  if (table === 'sv_projects') return rows.map((row) => {
    const status = String(row.status || 'analyzing');
    const stages = row.stage_state && typeof row.stage_state === 'object' ? Object.values(row.stage_state) : [];
    const persisted = stages.length ? (stages.filter((value) => value === 'done' || value === 'skipped').length / stages.length) * 100 : NaN;
    const identity = row.product_identity && typeof row.product_identity === 'object' ? row.product_identity.name : '';
    let hostname = '';
    try { hostname = new URL(String(row.url || '')).hostname.replace(/^www\./, ''); } catch { hostname = String(row.url || ''); }
    return makeJob(table, row, 'saas-verger', 'SaaS Verger', String(identity || hostname || 'SaaS product video'), prettyStage(status), Number.isFinite(persisted) ? persisted : (SV_PROGRESS[status] ?? 5), stateFrom(status, ['completed'], ['failed', 'error'], ['analyzing', 'scripting', 'building', 'rendering']));
  });
  if (table === 'video_enhancements') return rows.map((row) => {
    const status = String(row.status || 'processing').toLowerCase();
    return makeJob(table, row, 'video-enhancer', 'Video Enhancer', String(row.title || 'Video enhancement'), prettyStage(status), status === 'completed' ? 100 : Number(row.progress || 8), stateFrom(status, ['completed'], ['failed', 'error'], ['pending', 'processing']));
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
    const progress = status === 'completed' ? 100 : status === 'failed' ? 100 : status === 'processing' ? 65 : 15;
    const title = String(row.script || '').trim().replace(/\s+/g, ' ').slice(0, 54);
    return makeJob(table, row, 'vidverge-agent', 'HeyGen', title || String(row.avatar_name || 'HeyGen talking head'), stage, progress, stateFrom(status, ['completed'], ['failed', 'error'], ['pending', 'processing']));
  });
  return [];
}

async function loadLiveJobs(): Promise<QueueJob[]> {
  const db = (window as any).__workspaceDb;
  if (!db?.from) return [];
  const tables = ['sceneforge_projects', 'fc_projects', 's2v_films', 'sv_projects', 'video_enhancements', HEYGEN_RENDER_TABLE];
  const results = await Promise.allSettled(tables.map(async (table) => {
    const response = await db.from(table).orderBy('updated_at', 'desc').limit(8).get();
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

async function uploadAttachment(file: File) {
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
          <stop offset="0%" stopColor="var(--vv-gold-light, #FFD9A0)" />
          <stop offset="100%" stopColor="var(--vv-gold, #F5A623)" />
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
        stroke="var(--vv-gold, #F5A623)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </svg>
  );
}

export default function App() {
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [status, setStatus] = useState(IDLE_STATUS);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [activity, setActivity] = useState<string[]>(['Connecting to your studio queue…']);
  const [selectedAppId, setSelectedAppId] = useState(TARGET_APPS[0].id);
  const [calm, setCalm] = useState(false);
  const [openSection, setOpenSection] = useState<'avatar' | 'voice' | null>(null);
  const [touchedSections, setTouchedSections] = useState<Record<'avatar' | 'voice', boolean>>({ avatar: false, voice: false });
  const [heygenAvatar, setHeygenAvatar] = useState<HeygenAvatar | null>(null);
  const [heygenVoice, setHeygenVoice] = useState<HeygenVoice | null>(null);
  const [heygenRender, setHeygenRender] = useState<PersistedHeygenRenderState | null>(null);
  const [heygenRenderDismissed, setHeygenRenderDismissed] = useState(false);
  const [videoIntegration, setVideoIntegration] = useState<VideoIntegrationId>(() => loadVideoSelection().integration);
  const [videoModel, setVideoModel] = useState(() => loadVideoSelection().model);
  const [providerError, setProviderError] = useState('');
  const previousStates = useRef<Record<string, JobState>>({});
  const transitionReset = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await loadLiveJobs();
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
        setStatus(completed ? 'Completed' : 'Needs attention');
        transitionReset.current = window.setTimeout(() => {
          transitionReset.current = null;
          setAgentState(live.state);
          setStatus(live.label);
        }, 2600);
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRecoverableHeygenRender()
      .then((recovered) => {
        if (!cancelled && recovered) setHeygenRender((current) => current || recovered);
      })
      .catch((error) => console.warn('Could not restore the latest HeyGen render.', error));
    return () => { cancelled = true; };
  }, []);

  // HeyGen renders keep their own polling clock, but their ticket and outcome
  // live in WorkspaceDB so a reload can resume the same render.
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

  async function startHeygenRender(avatar: HeygenAvatar, script: string) {
    const voice = heygenVoice;
    setHeygenRenderDismissed(false);
    setHeygenRender({
      recordId: null,
      phase: 'creating',
      videoId: '',
      api: 'v3',
      script,
      avatarName: avatar.name,
      voiceName: voice?.name || '',
      videoUrl: '',
      thumbnailUrl: '',
      error: '',
      startedAt: Date.now(),
    });

    let ticket: HeygenRenderTicket;
    try {
      ticket = await createHeygenVideo({ avatarId: avatar.id, voiceId: voice?.id, script });
    } catch (error) {
      setHeygenRender(null);
      throw new Error(heygenErrorMessage(error, 'HeyGen could not start this render.'));
    }

    let recordId: RowId | null = null;
    try {
      recordId = await insertHeygenRender({
        videoId: ticket.videoId,
        apiVersion: ticket.api,
        script,
        avatarId: avatar.id,
        avatarName: avatar.name,
        voiceId: voice?.id || '',
        voiceName: voice?.name || '',
      });
    } catch (error) {
      console.warn('HeyGen started, but its recovery record could not be saved.', error);
    }
    setHeygenRender((previous) => previous ? {
      ...previous,
      recordId,
      phase: 'processing',
      videoId: ticket.videoId,
      api: ticket.api,
    } : previous);
  }

  async function handleSubmit(prompt: string, appId: string, file: File | null) {
    // A chosen HeyGen character renders here; with none chosen the brief is
    // handed to the selected studio exactly as before.
    if (heygenAvatar) {
      await startHeygenRender(heygenAvatar, prompt);
      return;
    }
    const attachment = file ? await uploadAttachment(file) : null;
    saveVideoSelection(videoIntegration, videoModel);
    saveVidvergeHandoff({ appId, prompt, attachment, videoIntegration, videoModel });
    openVidvergeStudio(appId);
  }

  function handleVideoProviderChange(integration: VideoIntegrationId, model: string) {
    setProviderError('');
    setVideoIntegration(integration);
    setVideoModel(model);
    saveVideoSelection(integration, model);
  }

  function openJob(job: QueueJob) {
    saveVidvergeHandoff({ appId: job.appId, projectId: job.projectId });
    openVidvergeStudio(job.appId);
  }

  function toggleSection(section: 'avatar' | 'voice') {
    setOpenSection((previous) => (previous === section ? null : section));
    setTouchedSections((previous) => (previous[section] ? previous : { ...previous, [section]: true }));
  }

  const headerDot =
    agentState === 'working'
      ? 'var(--vv-gold)'
      : agentState === 'error'
        ? 'var(--vv-error)'
        : 'var(--vv-success)';
  const headerLabel =
    agentState === 'working' ? 'Agent working' : agentState === 'error' ? 'Agent paused' : 'Agent ready';

  return (
    <div className="relative h-full w-full overflow-y-auto" style={{ ...TOKENS, background: 'var(--vv-bg)' }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgba(245,166,35,0.07),transparent_72%)]" />

      <header
        className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--vv-border)] px-5 backdrop-blur-xl md:px-8"
        style={{ background: 'rgba(8,8,15,0.72)' }}
      >
        <div className="flex items-center gap-2.5">
          <VergeMark />
          <span className="text-[15px] font-medium tracking-tight text-white">Vidverge</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: headerDot, boxShadow: `0 0 8px ${headerDot}` }}
            />
            <span className="hidden text-[12px] text-[var(--vv-text-dim)] sm:inline">{headerLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => setCalm((prev) => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
            title={calm ? 'Motion is calmed — switch back to full motion' : 'Calm the motion'}
            aria-label={calm ? 'Switch back to full motion' : 'Calm the motion'}
          >
            {calm ? <ZapOff size={15} /> : <Zap size={15} />}
          </button>
        </div>
      </header>

      <main className="relative mx-auto flex min-h-[calc(100%-3.5rem)] w-full max-w-[1180px] flex-col justify-center px-5 pb-16 pt-6 md:px-8">
        <AgentCanvas agentState={agentState} statusLabel={status} calm={calm} />

        <div className="mx-auto w-full max-w-[880px]">
          {!heygenAvatar && (
            <div className="mb-4 rounded-2xl border border-[var(--vv-border)] bg-[color-mix(in_srgb,var(--vv-surface)_88%,transparent)] px-4 py-3">
              <VideoIntegrationPicker
                sceneOnly
                integration={videoIntegration}
                model={videoModel}
                onChange={handleVideoProviderChange}
                label="Video provider"
                note="Studios you open inherit this integration and model for scene generation."
              />
              {providerError ? <p className="mt-2 text-[11px] text-[var(--vv-error)]">{providerError}</p> : null}
            </div>
          )}

          <CreateBar
            apps={TARGET_APPS}
            selectedAppId={selectedAppId}
            onSelectApp={setSelectedAppId}
            onSubmit={handleSubmit}
            busy={agentState === 'working'}
          />
          <p className="mt-3 text-center text-[11px] text-white/25">
            {heygenAvatar
              ? 'Create renders a HeyGen talking head here · clear the character to route to a studio instead'
              : 'Describe the video · pick the studio · the agent takes it from there'}
          </p>

          {(heygenAvatar || heygenVoice) && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {heygenAvatar && (
                <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--vv-gold)_40%,transparent)] bg-[color-mix(in_srgb,var(--vv-gold)_10%,transparent)] py-1 pl-1 pr-3 text-[11px] text-white/80">
                  {heygenAvatar.previewImage ? (
                    <img src={heygenAvatar.previewImage} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <User size={12} className="ml-1.5 text-[var(--vv-gold)]" />
                  )}
                  <span className="max-w-[160px] truncate">{heygenAvatar.name}</span>
                </span>
              )}
              {heygenVoice && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--vv-gold)_40%,transparent)] bg-[color-mix(in_srgb,var(--vv-gold)_10%,transparent)] px-3 py-1 text-[11px] text-white/80">
                  <Volume2 size={12} className="text-[var(--vv-gold)]" />
                  <span className="max-w-[160px] truncate">{heygenVoice.name}</span>
                </span>
              )}
            </div>
          )}

          <div className="mt-5 space-y-2.5">
            <HeygenSection
              title="Character (HeyGen)"
              summary={heygenAvatar ? heygenAvatar.name : 'Put a HeyGen presenter on camera, or skip it'}
              icon={<User size={14} />}
              open={openSection === 'avatar'}
              onToggle={() => toggleSection('avatar')}
            >
              <HeygenAvatarPicker
                active={touchedSections.avatar}
                selected={heygenAvatar}
                onSelect={setHeygenAvatar}
              />
            </HeygenSection>

            <HeygenSection
              title="Voice (HeyGen)"
              summary={heygenVoice ? `${heygenVoice.name} · ${heygenVoice.language}` : "Pick a HeyGen voice, or use the character's default"}
              icon={<Mic size={14} />}
              open={openSection === 'voice'}
              onToggle={() => toggleSection('voice')}
            >
              <HeygenVoicePicker
                active={touchedSections.voice}
                selected={heygenVoice}
                onSelect={setHeygenVoice}
              />
            </HeygenSection>

            {heygenRender && !heygenRenderDismissed && (
              <HeygenRenderPanel render={heygenRender} onDismiss={() => setHeygenRenderDismissed(true)} />
            )}
          </div>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ProjectQueue jobs={jobs} onOpen={openJob} />
          <div className="lg:pt-[28px]">
            <AgentActivity state={agentState} lines={activity} />
          </div>
        </div>
      </main>
    </div>
  );
}
