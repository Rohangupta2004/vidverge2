// Product Videos — the browser half of the Story Mode pipeline.
//
// Story Mode produces nothing in the tab any more. The app hands the brief to
// the runStoryModePipeline server function, which plans the scene manifest,
// generates the stills, records the narration, composes the Remotion timeline
// and drives the render — then the app polls the pv_projects row for status,
// stage, assets, audio and the finished MP4. Closing the tab no longer kills a
// run, and a failure now carries the real exception text instead of whatever
// the last fetch happened to say.

const STORY_HOOK_ENDPOINT = '/api/hooks/execute/workspace-660069/runStoryModePipeline';

export interface StoryBrief {
  productName: string;
  audience: string;
  tone: string;
  keyMessage: string;
  url: string;
  imageUrl: string | null;
  voiceover: boolean;
  // URL-first intake: the page the script was read from, the problem the
  // script writer identified there, whatever extra direction the customer
  // gave, and the brand the film is dressed in.
  sourceUrl?: string;
  focus?: string;
  problem?: string;
  logoUrl?: string | null;
  accent?: string;
}

export interface StoryScene {
  id: string;
  narration: string;
  subtitle: string;
  background: string;
  characterCutout: string | null;
  props?: string | null;
  sfx?: string | null;
}

export interface StoryScript {
  title: string;
  musicTrack: number | null;
  scenes: StoryScene[];
  productName?: string;
  audience?: string;
  problem?: string;
  keyMessage?: string;
  ctaText?: string;
  tone?: string;
}

export interface LogoCandidate {
  url: string;
  why: string;
  vector?: boolean;
}

export interface ScoutResult {
  plan: StoryScript;
  brief: Partial<StoryBrief>;
  logos: LogoCandidate[];
  source: { url: string; title: string; siteName: string; description: string } | null;
}

export interface StoryProjectRow {
  id: number;
  title: string | null;
  mode: string;
  status: string;
  stage: string | null;
  error: string | null;
  assets: any;
  audio: any;
  plan: any;
  music_track: number | null;
  duration_frames: number | null;
  render_operation_id: string | null;
  video_url: string | null;
  updated_at?: string;
}

function runtime(): any {
  return typeof window === 'undefined' ? {} : (window as any);
}

function workspaceToken(): string {
  return String(runtime().__workspaceDb?.token || '');
}

// The same fallback chain the other studio apps in this space use — the
// runtime context publishes the canonical wses_ id on several globals
// depending on how the shell booted.
export function resolveSessionId(): string {
  const w = runtime();
  const direct = w.__spaceSessionId || w.__workspaceDb?.sessionId || w.__SESSION_ID__ || w.__WORKSPACE_SESSION_ID__;
  if (typeof direct === 'string' && direct) return direct;
  const spaceId = w.__APP_ID__ || w.__SPACE_ID__ || 'workspace-660069';
  try {
    const raw = window.localStorage.getItem(`space_session_${spaceId}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const fromJson = parsed?.sessionId || parsed?.session_id || parsed?.id;
        if (typeof fromJson === 'string' && fromJson) return fromJson;
      } catch {
        return raw;
      }
    }
  } catch {
    // storage unavailable — fall through
  }
  return '';
}

async function storyHook<T>(payload: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = workspaceToken();
  const sessionId = resolveSessionId();
  if (token) headers['X-Workspace-DB-Token'] = token;
  if (sessionId) headers['X-Session-Id'] = sessionId;
  const response = await fetch(STORY_HOOK_ENDPOINT, {
    method: 'POST',
    headers,
    // `wt` lets the server pipeline reach the platform voiceover endpoint,
    // which only answers a request carrying a live workspace session. It is
    // the same public token the page already holds and the hook never stores
    // it.
    body: JSON.stringify({ ...payload, wt: token || undefined }),
  });
  const raw = await response.json().catch(() => null);
  // Hook answers sit either at the top level or under `response`.
  const data = raw && typeof raw === 'object' && ('success' in raw || 'error' in raw) ? raw : (raw?.response ?? raw);
  if (!response.ok || !data || data.success === false || data.error) {
    throw new Error(String(data?.error || `The video service could not be reached (HTTP ${response.status}).`));
  }
  return data as T;
}

/**
 * Read the customer's website, work out what the product is and what problem
 * it removes, and write a script they can check — all before a single paid
 * asset is generated. Nothing is saved by this call.
 */
export async function scoutStory(input: { url?: string; focus?: string }): Promise<ScoutResult> {
  return await storyHook<ScoutResult>({
    op: 'scout',
    url: input.url ? input.url.trim() : undefined,
    focus: input.focus ? input.focus.trim() : undefined,
  });
}

/**
 * Create the pv_projects row and start the server pipeline. Returns the id.
 * When `plan` is supplied it is the script the customer just read and
 * approved, so the server produces exactly that rather than writing its own.
 */
export async function startStoryRun(brief: StoryBrief, plan?: StoryScript | null): Promise<number> {
  const data = await storyHook<{ projectId: number }>({ op: 'create', brief, plan: plan || undefined });
  const projectId = Number(data?.projectId);
  if (!projectId) throw new Error('The video project could not be created.');
  return projectId;
}

/** Clear a failed run's outputs and send it back through the pipeline. */
export async function retryStoryRun(projectId: number): Promise<void> {
  await storyHook({ op: 'retry', project_id: projectId });
}

/** Wake a run whose server-side chain died while nobody was watching. */
export async function nudgeStoryRun(projectId: number): Promise<void> {
  await storyHook({ op: 'tick', project_id: projectId, source: 'browser' });
}

/** Read one project row straight from WorkspaceDB — this is the poll. */
export async function readStoryProject(projectId: number): Promise<StoryProjectRow | null> {
  const db = runtime().__workspaceDb;
  if (!db) return null;
  const result = await db.from('pv_projects').getById(projectId);
  const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
  return (row as StoryProjectRow) || null;
}

const LIVE_STATUSES = ['queued', 'planning', 'generating_images', 'generating_audio', 'rendering', 'draft', 'assets', 'audio', 'composing'];

export function isStoryLive(status: unknown): boolean {
  return LIVE_STATUSES.indexOf(String(status || '')) >= 0;
}

/** 'complete' is what the retired in-browser pipeline wrote; 'completed' is the server ladder. */
export function isVideoReady(status: unknown): boolean {
  const value = String(status || '');
  return value === 'completed' || value === 'complete';
}

export function isVideoFailed(status: unknown): boolean {
  return String(status || '') === 'failed';
}

/** Map the server status onto the studio's five-step progress stepper. */
export function storyPhaseKey(project: StoryProjectRow | null): 'planning' | 'assets' | 'audio' | 'composing' | 'rendering' | 'done' {
  const status = String(project?.status || 'queued');
  if (isVideoReady(status)) return 'done';
  if (status === 'generating_images' || status === 'assets') return 'assets';
  if (status === 'generating_audio' || status === 'audio') return 'audio';
  if (status === 'rendering' || status === 'composing') {
    return project?.render_operation_id ? 'rendering' : 'composing';
  }
  return 'planning';
}

const STAGE_FALLBACKS: Record<string, string> = {
  queued: 'Queued — the server pipeline is picking this up…',
  planning: 'Directing the reel — writing the scene manifest…',
  generating_images: 'Generating scene images…',
  generating_audio: 'Recording the voiceover…',
  rendering: 'Rendering video on the server…',
  completed: 'Done ✓',
  complete: 'Done ✓',
};

/** The line the customer reads. The server writes it; this only fills gaps. */
export function storyStageLabel(project: StoryProjectRow | null): string {
  if (!project) return 'Starting…';
  if (isVideoReady(project.status)) return 'Done ✓';
  const stage = String(project.stage || '').trim();
  if (stage) return stage;
  return STAGE_FALLBACKS[String(project.status)] || 'Working…';
}

/** The narration note the server leaves when no voice service was reachable. */
export function storyVoiceNote(project: StoryProjectRow | null): string {
  const note = project?.audio?.voiceNote;
  return typeof note === 'string' && note.trim() ? note.trim() : '';
}
