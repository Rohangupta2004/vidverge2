// CineAgent — cine_projects persistence.
//
// Uses the WorkspaceDB REST API with the injected workspace token (the same
// proven pattern Video Enhancer's jobStore uses), with a defensive response
// reader so an envelope-shape difference never breaks project creation.
// Rows are session-owned (default policy): each visitor sees their own
// projects. Every pipeline stage checkpoints the whole row, so a refresh
// resumes where the run left off.

import { workspaceToken } from './ai';
import { WORKSPACE_ID } from './platform';
import type { ProjectRow, ActivityLine, StageId } from './types';

const TABLE = 'cine_projects';
const DATA_URL = '/api/workspaces/' + WORKSPACE_ID + '/data/' + TABLE;

// ---------------------------------------------------------------------------
// Local fallback — a sign-in / session hiccup must never block an edit.
// Rows that could not be written to WorkspaceDB live in localStorage under
// NEGATIVE ids. They resume on this device; that limitation is logged to the
// activity feed by the caller.
// ---------------------------------------------------------------------------

const LOCAL_KEY = 'cineagent_local_projects_v1';

function readLocal(): Record<string, ProjectRow> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeLocal(map: Record<string, ProjectRow>): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(map));
  } catch { /* storage full — run continues in memory */ }
}

export function isLocalProject(id: number): boolean {
  return id < 0;
}

function rowsFrom(payload: any): any[] {
  const value = payload && payload.data != null
    ? payload.data
    : payload && payload.rows != null
      ? payload.rows
      : payload;
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}

async function dbRequest(path: string, init: RequestInit = {}): Promise<any> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch(DATA_URL + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
      'X-Workspace-DB-Token': token,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data.error === 'string' ? data.error : '';
    throw new Error(detail || ('Could not reach project storage (HTTP ' + res.status + ').'));
  }
  return data;
}

function freshRow(name: string, prefs: ProjectRow['prefs']): Omit<ProjectRow, 'id'> {
  return {
    name,
    status: 'running',
    stage: 'upload',
    progress: { pct: 0, detail: 'Starting' },
    source: null,
    analysis: null,
    plan: null,
    assets: null,
    qa: null,
    result: null,
    activity: [],
    prefs: prefs || null,
    error: null,
  } as Omit<ProjectRow, 'id'>;
}

/** Creates the project row; falls back to a device-local row (negative id). */
export async function createProject(name: string, prefs: ProjectRow['prefs']): Promise<{ id: number; local: boolean }> {
  try {
    const rows = rowsFrom(await dbRequest('', {
      method: 'POST',
      body: JSON.stringify({ rows: [freshRow(name, prefs)] }),
    }));
    const id = Number(rows[0]?.id);
    if (Number.isFinite(id) && id > 0) return { id, local: false };
    throw new Error('No id returned');
  } catch {
    const id = -Date.now();
    const map = readLocal();
    map[String(id)] = {
      ...(freshRow(name, prefs) as ProjectRow),
      id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeLocal(map);
    return { id, local: true };
  }
}

export async function saveProject(id: number, patch: Partial<ProjectRow>): Promise<void> {
  if (isLocalProject(id)) {
    const map = readLocal();
    const row = map[String(id)];
    if (row) {
      map[String(id)] = { ...row, ...patch, id, updated_at: new Date().toISOString() };
      writeLocal(map);
    }
    return;
  }
  const body: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined) body[key] = value;
  });
  await dbRequest('/' + encodeURIComponent(String(id)), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function loadProject(id: number): Promise<ProjectRow | null> {
  if (isLocalProject(id)) {
    return readLocal()[String(id)] || null;
  }
  try {
    const query = new URLSearchParams({ _limit: '1', id: 'eq.' + String(id) });
    const rows = rowsFrom(await dbRequest('?' + query.toString()));
    return (rows[0] as ProjectRow) || null;
  } catch {
    return null;
  }
}

export async function listProjects(limit = 20): Promise<ProjectRow[]> {
  let remote: ProjectRow[] = [];
  try {
    const query = new URLSearchParams({
      _limit: String(limit),
      _sort: 'updated_at',
      _order: 'desc',
    });
    remote = rowsFrom(await dbRequest('?' + query.toString())) as ProjectRow[];
  } catch { /* session not ready — show local rows at least */ }
  const local = Object.values(readLocal());
  const all = [...local, ...remote];
  all.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return all.slice(0, limit);
}

export async function deleteProject(id: number): Promise<void> {
  if (isLocalProject(id)) {
    const map = readLocal();
    delete map[String(id)];
    writeLocal(map);
    return;
  }
  await dbRequest('/' + encodeURIComponent(String(id)), { method: 'DELETE' });
}

// --- activity log -------------------------------------------------------------

export function appendActivity(lines: ActivityLine[] | null | undefined, text: string, kind: ActivityLine['kind'] = 'info'): ActivityLine[] {
  const next = Array.isArray(lines) ? lines.slice(-120) : [];
  next.push({ t: Date.now(), text, kind });
  return next;
}

export function stagePct(stage: StageId, within = 0): number {
  const order: StageId[] = ['upload', 'analyze', 'direct', 'assets', 'render', 'review', 'finish'];
  const idx = Math.max(0, order.indexOf(stage));
  const base = idx / order.length;
  return Math.min(100, Math.round((base + Math.max(0, Math.min(1, within)) / order.length) * 100));
}
