/**
 * Script-to-Video pipeline client — thin wrapper around the s2v-run server
 * function, which owns the entire 10-stage autonomous pipeline server-side.
 * The browser never writes s2v_* tables directly; every mutation and read
 * goes through one hook op so runs survive tab-close, sign-out and reloads.
 */

export const PIPELINE_HOOK = '/api/hooks/execute/workspace-660069/s2v-run';
export const WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

// ---------------------------------------------------------------------------
// Types (mirror of the server data model)
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | 'briefing' | 'blueprint' | 'casting' | 'rendering' | 'review'
  | 'assembling' | 'post' | 'ready' | 'failed' | 'stalled';

export type SceneStatus =
  | 'queued' | 'prepping' | 'rendering' | 'judging'
  | 'passed' | 'auto_fixed' | 'unchecked' | 'needs_attention' | 'failed' | 'cut';

export interface Question { id: string; text: string; options: string[] }

export interface Project {
  id: number;
  session_id: string;
  title: string;
  mode: 'short' | 'long';
  aspect_ratio: '9:16' | '1:1' | '16:9';
  status: ProjectStatus;
  stage_note: string | null;
  input_text: string | null;
  input_shape: 'word' | 'line' | 'script' | 'url' | null;
  input_url: string | null;
  chips: string[] | null;
  focus: string | null;
  questions: Question[] | null;
  answers: Record<string, string> | null;
  master_prompt: string | null;
  script_text: string | null;
  brand_kit: any;
  ad_mode: boolean;
  strategy_choice: 'flowing' | 'planned' | 'auto' | null;
  strategy: 'chained' | 'bookends' | null;
  /** PRD 1.3 — user-selected clip renderer ('veo' default, 'omni' fallback). */
  video_model: 'veo' | 'omni' | null;
  /** Requested finished-film length in seconds; always capped at 60. */
  target_length_s: number | null;
  parallel_lanes: boolean;
  /** Dynamic planned shot count. It may exceed the number of user scenes. */
  scene_count: number | null;
  assembled_url: string | null;
  final_url: string | null;
  thumbs: string[] | null;
  layers: any;
  metrics: any;
  error: string | null;
  render_started_at: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SceneRow {
  id: number;
  idx: number;
  sequence_key: string | null;
  spec: any;
  status: SceneStatus;
  attempts: number;
  model: string | null;
  clip_url: string | null;
  first_frame_url: string | null;
  last_frame_url: string | null;
  open_image_url: string | null;
  close_image_url: string | null;
  transcript: string | null;
  judge: { pass?: boolean; unchecked?: boolean; checks?: Record<string, boolean>; reason?: string } | null;
  repair: any;
  alternate_render: boolean;
  duration_s: number | null;
  submitted_at: string | null;
  finished_at: string | null;
  /** Full-resolution PNG fallback frames from the clip's final ~1 second. */
  browser_frames: { t: number; url: string }[] | null;
  /** Set when the server asks the watching tab for mandatory fallback frames. */
  frames_requested_at: string | null;
  /** Stable user-scene mapping; multiple shots may map to one source scene. */
  source_scene_id: string | null;
  shot_kind: 'story' | 'bridge' | null;
  /** Four to six tail samples, including the mandatory final-frame PNG. */
  trailing_frames: { t?: number; timestamp?: number; url: string }[] | null;
  /** Claude vision description of the exact physical/camera state at cut time. */
  end_state: {
    characters?: unknown[];
    motion?: unknown;
    camera?: unknown;
    location?: unknown;
    lighting?: unknown;
    time_of_day?: unknown;
    props_held?: unknown[];
    action_in_progress?: unknown;
    [key: string]: unknown;
  } | null;
  /** Automated last-to-first join comparison for this shot and its successor. */
  continuity_check: { pass?: boolean; score?: number; reason?: string; [key: string]: unknown } | null;
}

export interface CharacterRow {
  id: number;
  char_key: string;
  name: string;
  token: string;
  role: string;
  appearance: string | null;
  wardrobe: string | null;
  ref_image_url: string | null;
  status: 'pending' | 'generating' | 'ready' | 'blocked' | 'superseded';
  blocked_reason: string | null;
}

export interface AgentEvent {
  id: number;
  stage: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  created_at: string;
}

export interface LegacyProject {
  legacy: true;
  id: string;
  title: string;
  status: 'ready';
  mode: string;
  aspect_ratio: string;
  scene_count: number;
  final_url: string | null;
  clips: string[];
  created_at: string;
}

export interface StatusPayload {
  project: Project;
  scenes: SceneRow[];
  characters: CharacterRow[];
  events: AgentEvent[];
}

// ---------------------------------------------------------------------------
// Session plumbing
// ---------------------------------------------------------------------------

export function sessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}

export function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

// ---------------------------------------------------------------------------
// Hook transport
// ---------------------------------------------------------------------------

function unwrap(payload: any): any {
  if (payload && typeof payload === 'object' && payload.response !== undefined && payload._meta !== undefined) {
    return payload.response;
  }
  return payload;
}

export async function pipeline<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const sid = sessionId();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = wsToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  if (sid) headers['X-Session-Id'] = sid;
  const res = await fetch(PIPELINE_HOOK, {
    method: 'POST',
    headers,
    body: JSON.stringify({ op, session_id: sid, ...params }),
  });
  const raw = await res.json().catch(() => null);
  const data = unwrap(raw);
  if (!res.ok || !data || data.success === false || data.error) {
    throw new Error(String((data && data.error) || `The pipeline did not answer (HTTP ${res.status}).`));
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Op helpers
// ---------------------------------------------------------------------------

export const api = {
  list: () => pipeline<{ projects: Project[]; legacy: LegacyProject[] }>('list'),
  create: (params: { input_text: string; input_url?: string; upload_text?: string; mode: string; aspect_ratio: string; chips: string[]; focus: string; target_length_s?: number; video_model?: string }) =>
    pipeline<{ project: Project; questions: Question[]; scrape_note: string | null }>('create', params),
  brief: (projectId: number, answers: Record<string, string>) =>
    pipeline<{ project: Project; scenes: any[]; characters: any[]; assumptions: string[] }>('brief', { project_id: projectId, answers }),
  start: (projectId: number) => pipeline<{ project: Project }>('start', { project_id: projectId }),
  tick: (projectId: number) => pipeline<{ project: Project }>('tick', { project_id: projectId }),
  status: (projectId: number) => pipeline<StatusPayload>('status', { project_id: projectId }),
  editScene: (projectId: number, idx: number, patch: Record<string, unknown>) =>
    pipeline('edit_scene', { project_id: projectId, idx, patch }),
  /** Regenerating shot N invalidates and rebuilds the continuity chain from N onward. */
  regen: (projectId: number, scenes: number[], note?: string) =>
    pipeline<{ project: Project }>('regen', { project_id: projectId, scenes, note: note || '' }),
  recast: (projectId: number, charKey: string, appearance: string) =>
    pipeline('recast', { project_id: projectId, char_key: charKey, appearance }),
  assemble: (projectId: number) => pipeline<{ project: Project }>('assemble', { project_id: projectId }),
  layers: (projectId: number, layers: Record<string, unknown>) =>
    pipeline<{ project: Project }>('layers', { project_id: projectId, layers }),
  cut: (projectId: number, scenes: number[]) => pipeline('cut', { project_id: projectId, scenes }),
  resume: (projectId: number) => pipeline<{ project: Project }>('resume', { project_id: projectId }),
  /** Hand the judge frames this tab photographed of a clip (frame-extractor outage path). */
  attachFrames: (projectId: number, sceneId: number, frames: { t: number; url: string }[]) =>
    pipeline<{ attached: number }>('attach_frames', { project_id: projectId, scene_id: sceneId, frames }),
  command: (text: string, projectId?: number) =>
    pipeline<{ reply: string; action: string }>('command', { text, project_id: projectId }),
};

// ---------------------------------------------------------------------------
// ElevenLabs music (browser-side, wallet-authenticated) — Finish screen only.
// Founder decision: BOTH music paths live — keep the model's own score, or
// rescore with ElevenLabs. Film speech is already one exact, stored voiceover.
// ---------------------------------------------------------------------------

export async function generateMusic(prompt: string, lengthMs: number): Promise<string> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/music/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ prompt, lengthMs: Math.max(5000, Math.min(240000, lengthMs)), instrumental: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success || !data.audioUrl) {
    throw new Error(String((data && data.error) || 'Music generation failed.'));
  }
  return String(data.audioUrl);
}

// ---------------------------------------------------------------------------
// Upload parsing (Stage 0 file input): txt / md / rtf / fdx handled locally.
// ---------------------------------------------------------------------------

export async function parseUpload(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const raw = await file.text();
  if (name.endsWith('.fdx')) {
    const doc = new DOMParser().parseFromString(raw, 'text/xml');
    const paras = Array.from(doc.querySelectorAll('Paragraph'));
    const text = paras.map((par) => {
      const type = par.getAttribute('Type') || '';
      const line = Array.from(par.querySelectorAll('Text')).map((t) => t.textContent || '').join('');
      return type && line ? `${type.toUpperCase()}: ${line}` : line;
    }).filter(Boolean).join('\n');
    if (text.trim()) return text;
    throw new Error('That Final Draft file came back empty.');
  }
  if (name.endsWith('.rtf')) {
    return raw
      .replace(/\\par[d]?/g, '\n')
      .replace(/\{\\[^{}]*\}/g, '')
      .replace(/\\'[0-9a-f]{2}/g, ' ')
      .replace(/\\[a-z]+-?\d* ?/g, '')
      .replace(/[{}]/g, '')
      .trim();
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) return raw;
  throw new Error('Upload .txt, .md, .rtf or .fdx — or paste the script text directly. PDF and Word support is coming.');
}

// ---------------------------------------------------------------------------
// PRD §9.1 design tokens — this product's own surface palette. The OS shell
// keeps the workspace brand; these tokens style ONLY the Script-to-Video app.
// ---------------------------------------------------------------------------

export const T = {
  canvas: '#131316',
  raised: '#1C1C21',
  bone: '#EDEBE8',
  muted: '#77757F',
  dim: '#4A4852',
  live: '#E8A33C',
  done: '#7FD4B4',
  fault: '#E2726F',
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
  sans: "'Inter', system-ui, sans-serif",
} as const;

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

export function verdictBadge(s: SceneRow): { word: string; color: string; reason: string } {
  if (s.status === 'passed') return { word: 'Consistent', color: T.done, reason: s.judge?.reason || 'Passed first time.' };
  if (s.status === 'auto_fixed') return { word: 'Fixed once', color: T.live, reason: s.judge?.reason || 'Auto-regenerated and passed.' };
  if (s.status === 'unchecked') return { word: 'Review', color: T.live, reason: s.judge?.reason || 'Shot checked using scene reference. Tap to review.' };
  if (s.status === 'needs_attention') return { word: 'Needs attention', color: T.fault, reason: (s.repair && s.repair.reason) || s.judge?.reason || 'Failed twice — kept the better take.' };
  if (s.status === 'failed') return { word: 'Failed', color: T.fault, reason: (s.repair && s.repair.reason) || 'No usable take.' };
  if (s.status === 'cut') return { word: 'Cut', color: T.dim, reason: 'Excluded from assembly.' };
  if (s.status === 'rendering') return { word: 'Filming', color: T.live, reason: 'Rendering now.' };
  if (s.status === 'judging') return { word: 'Checking', color: T.live, reason: 'Judge is reviewing the clip.' };
  if (s.status === 'prepping') return { word: 'Drawing', color: T.live, reason: 'Bookend frames being drawn.' };
  return { word: 'Queued', color: T.dim, reason: 'Waiting its turn.' };
}
