/**
 * FACELESS CONTENT — persistence.
 *
 * A run takes long enough that the tab will be closed halfway through it, so
 * every stage writes to `fc_projects` / `fc_scenes` as it completes. The
 * progress view polls the project row every two seconds rather than reading
 * component state, which means a reload drops straight back into the terminal
 * where the pipeline actually is.
 *
 * Both tables carry a TEXT primary key the app generates, so scenes can be
 * inserted with their project id already known.
 */

import { resolveOwnedSessions, rowIsOwnedBy, waitForDbSession } from '../../lib/reelioStudio';
import { FactCheckItem, Niche, Orientation, ScriptBlock } from './prompts';

export const PROJECTS_TABLE = 'fc_projects';
export const SCENES_TABLE = 'fc_scenes';

export type ProjectStatus =
  | 'pending' | 'researching' | 'scripting' | 'prompting'
  | 'generating' | 'stitching' | 'done' | 'failed';

export type LogState = 'done' | 'active' | 'pending' | 'failed';

export interface LogLine {
  text: string;
  state: LogState;
}

export interface FcProject {
  id: string;
  topic: string | null;
  niche: Niche | null;
  length_target: number | null;
  orientation: Orientation | null;
  video_model: string | null;
  script_json: ScriptBlock[] | null;
  titles_json: string[] | null;
  thumbnail_line: string | null;
  fact_check_json: FactCheckItem[] | null;
  final_video_url: string | null;
  duration_seconds: number | string | null;
  stage: string | null;
  progress_log: LogLine[] | null;
  error_msg: string | null;
  status: ProjectStatus | null;
  created_at?: string;
  session_id?: string | null;
}

export interface FcScene {
  id: string;
  project_id: string | null;
  scene_index: number | null;
  block_name: string | null;
  timecode: string | null;
  vo_text: string | null;
  visual_description: string | null;
  video_prompt: string | null;
  seed_frame_url: string | null;
  video_url: string | null;
  duration_seconds: number | string | null;
  engine: string | null;
  error_msg: string | null;
  status: string | null;
  created_at?: string;
}

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Every row this browser owns, newest first. */
async function ownedRows<T>(table: string, limit = 200): Promise<T[]> {
  const owned = await resolveOwnedSessions();
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  const res = await client.from(table, { shared: true })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  const rows: any[] = Array.isArray(res?.data) ? res.data : [];
  return rows.filter((r) => rowIsOwnedBy(r, owned)) as T[];
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface NewProjectInput {
  topic: string;
  niche: Niche;
  lengthTarget: number;
  orientation: Orientation;
  videoModel: string;
}

export async function createProject(input: NewProjectInput): Promise<string> {
  const client = db();
  if (!client || typeof client.from !== 'function') {
    throw new Error('The workspace database is not available in this context.');
  }
  await waitForDbSession();
  const id = newId('fc');
  await client.from(PROJECTS_TABLE).insert({
    id,
    topic: input.topic,
    niche: input.niche,
    length_target: input.lengthTarget,
    orientation: input.orientation,
    video_model: input.videoModel,
    status: 'researching',
    stage: 'Researching topic',
    progress_log: [],
  });
  return id;
}

export async function updateProject(id: string, patch: Partial<FcProject>): Promise<void> {
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  await waitForDbSession();
  await client.from(PROJECTS_TABLE).update(id, patch);
}

/**
 * Progress writes are fire-and-forget from the pipeline's logger, and two
 * unawaited updates can land out of order — which is how a row that had
 * already moved on could end up storing "0 of 9" again, and a resumed
 * terminal could sit on that line forever. Queueing them behind one another
 * keeps the stored progress monotonic.
 */
let projectWrites: Promise<unknown> = Promise.resolve();

export function queueProjectUpdate(id: string, patch: Partial<FcProject>): Promise<void> {
  projectWrites = projectWrites
    .catch(() => undefined)
    .then(() => updateProject(id, patch).catch((e) => {
      console.warn('[FacelessContent] progress write failed:', e);
    }));
  return projectWrites as Promise<void>;
}

export async function getProject(id: string): Promise<FcProject | null> {
  const client = db();
  if (!client || typeof client.from !== 'function') return null;
  try {
    const res = await client.from(PROJECTS_TABLE, { shared: true }).getById(id);
    const row = res?.data;
    return row && row.id ? (row as FcProject) : null;
  } catch (e) {
    console.warn('[FacelessContent] getProject failed:', e);
    return null;
  }
}

export async function listProjects(): Promise<FcProject[]> {
  try {
    return await ownedRows<FcProject>(PROJECTS_TABLE, 100);
  } catch (e) {
    console.warn('[FacelessContent] listProjects failed:', e);
    return [];
  }
}

/**
 * How long an unfinished run stays resumable. A pipeline that died with its
 * tab leaves its row mid-flight forever; without this window the app would
 * reopen that dead terminal on every visit from then on.
 */
const RESUME_WINDOW_MS = 3 * 60 * 60 * 1000;

/** The newest recent run that has not finished, so a reload resumes the terminal. */
export async function findRunningProject(): Promise<FcProject | null> {
  const rows = await listProjects();
  const cutoff = Date.now() - RESUME_WINDOW_MS;
  const live = rows.filter((p) => {
    const status = String(p.status || '');
    if (status === 'done' || status === 'failed') return false;
    const started = p.created_at ? new Date(p.created_at).getTime() : NaN;
    return Number.isNaN(started) ? true : started >= cutoff;
  });
  return live[0] || null;
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export async function createScenes(projectId: string, blocks: ScriptBlock[], durationSeconds: number): Promise<FcScene[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  await waitForDbSession();
  const rows = blocks.map((b, i) => ({
    id: newId('fcs'),
    project_id: projectId,
    scene_index: i,
    block_name: b.block,
    timecode: b.timecode,
    vo_text: b.vo,
    visual_description: b.visual,
    video_prompt: null,
    seed_frame_url: null,
    video_url: null,
    duration_seconds: durationSeconds,
    engine: null,
    error_msg: null,
    status: 'pending',
  }));
  if (typeof client.from(SCENES_TABLE).bulkInsert === 'function') {
    await client.from(SCENES_TABLE).bulkInsert(rows);
  } else {
    for (const row of rows) await client.from(SCENES_TABLE).insert(row);
  }
  return rows as unknown as FcScene[];
}

export async function updateScene(id: string, patch: Partial<FcScene>): Promise<void> {
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  await waitForDbSession();
  await client.from(SCENES_TABLE).update(id, patch);
}

export async function listScenes(projectId: string): Promise<FcScene[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  try {
    const res = await client.from(SCENES_TABLE, { shared: true })
      .eq('project_id', projectId)
      .orderBy('scene_index', 'asc')
      .limit(200)
      .get();
    const rows: FcScene[] = Array.isArray(res?.data) ? res.data : [];
    return rows.slice().sort((a, b) => Number(a.scene_index || 0) - Number(b.scene_index || 0));
  } catch (e) {
    console.warn('[FacelessContent] listScenes failed:', e);
    return [];
  }
}
