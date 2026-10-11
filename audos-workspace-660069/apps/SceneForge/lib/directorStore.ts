// WorkspaceDB is the Director's durable system of record. localStorage remains
// the fast cache (directorSession.ts), but every meaningful film is mirrored
// here so it can be reopened on another signed-in device and surfaced by the
// Vidverge Agent.
import type { DirectorSession } from './directorSession';

export const DIRECTOR_TABLE = 'sf_director_films';

export type DirectorStatus = 'draft' | 'analyzing' | 'narrating' | 'assets' | 'rendering' | 'done' | 'failed';

export interface DirectorFilmSummary {
  id: number;
  title: string;
  status: DirectorStatus;
  script: string;
  narrationUrl: string;
  filmUrl: string;
  createdAt: string;
  updatedAt: string;
}

export async function directorOwnerKey(identity: string): Promise<string> {
  const normalized = String(identity || '').trim().toLowerCase();
  if (!normalized) throw new Error('Sign in before loading saved Director films.');
  const bytes = new TextEncoder().encode(`sceneforge-director:${normalized}`);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function client(): any {
  const db = (window as any).__workspaceDb;
  if (!db?.from) throw new Error('SceneForge needs the workspace data runtime. Refresh and try again.');
  return db;
}

function rowData(response: any): any {
  if (Array.isArray(response?.data)) return response.data[0] || null;
  return response?.data && typeof response.data === 'object' ? response.data : null;
}

export function titleFor(session: Pick<DirectorSession, 'title' | 'script'>): string {
  const explicit = String(session.title || '').trim();
  if (explicit) return explicit.slice(0, 120);
  const script = String(session.script || '').trim().replace(/\s+/g, ' ');
  if (!script) return 'Untitled Director film';
  const firstThought = script.split(/(?<=[.!?])\s/)[0] || script;
  return firstThought.slice(0, 72) + (firstThought.length > 72 ? '…' : '');
}

export function hasDirectorWork(session: DirectorSession): boolean {
  return Boolean(session.filmId || session.title.trim() || session.script.trim() || session.specs.length || session.narrationVideoId || session.filmUrl);
}

function rowToSession(row: any): DirectorSession {
  const metadata = row?.custom_voice_metadata && typeof row.custom_voice_metadata === 'object'
    ? row.custom_voice_metadata
    : {};
  const customUrl = String(row?.custom_voice_audio_url || '');
  return {
    filmId: Number(row?.id) || null,
    ownerKey: String(row?.owner_key || ''),
    title: String(row?.title || ''),
    script: String(row?.script || ''),
    notes: String(row?.notes || ''),
    avatarId: String(row?.avatar_id || ''),
    avatarName: String(row?.avatar_name || ''),
    voiceId: String(row?.voice_id || ''),
    voiceName: String(row?.voice_name || ''),
    speed: Number(row?.speed) || 1,
    useCustomVoice: Boolean(row?.use_custom_voice),
    customVoice: customUrl ? {
      url: customUrl,
      name: String(metadata.name || 'Custom narration'),
      sizeBytes: Number(metadata.sizeBytes) || 0,
      contentType: String(metadata.contentType || 'audio/mpeg'),
    } : null,
    accent: String(row?.accent || '#4FC3F7'),
    imageSource: row?.image_source === 'generated' ? 'generated' : 'stock',
    specs: Array.isArray(row?.scene_specs) ? row.scene_specs : [],
    narrationVideoId: String(row?.narration_video_id || ''),
    narrationApi: row?.narration_api === 'v2' ? 'v2' : row?.narration_api === 'v3' ? 'v3' : '',
    narrationUrl: String(row?.narration_url || ''),
    narrationSec: Number(row?.narration_duration_sec) || 0,
    renderOperationId: String(row?.render_operation_id || ''),
    filmUrl: String(row?.film_url || ''),
    status: (String(row?.status || 'draft') as DirectorStatus),
    updatedAt: String(row?.updated_at || ''),
  };
}

function payload(session: DirectorSession, status: DirectorStatus, ownerKey: string) {
  return {
    owner_key: ownerKey,
    title: titleFor(session),
    script: session.script,
    notes: session.notes || null,
    avatar_id: session.avatarId || null,
    avatar_name: session.avatarName || null,
    voice_id: session.voiceId || null,
    voice_name: session.voiceName || null,
    custom_voice_audio_url: session.customVoice?.url || null,
    custom_voice_metadata: session.customVoice ? {
      name: session.customVoice.name,
      sizeBytes: session.customVoice.sizeBytes,
      contentType: session.customVoice.contentType,
    } : null,
    speed: session.speed,
    use_custom_voice: session.useCustomVoice,
    accent: session.accent,
    image_source: session.imageSource,
    scene_specs: session.specs,
    narration_video_id: session.narrationVideoId || null,
    narration_api: session.narrationApi || null,
    narration_url: session.narrationUrl || null,
    narration_duration_sec: session.narrationSec || null,
    render_operation_id: session.renderOperationId || null,
    film_url: session.filmUrl || null,
    status,
  };
}

export async function saveDirectorFilm(session: DirectorSession, ownerKey: string): Promise<number | null> {
  if (!hasDirectorWork(session)) return session.filmId;
  const table = client().from(DIRECTOR_TABLE);
  if (session.filmId) {
    await table.update(session.filmId, { ...payload(session, session.status, ownerKey), updated_at: new Date().toISOString() });
    return session.filmId;
  }
  const response = await table.insert(payload(session, session.status, ownerKey));
  return Number(rowData(response)?.id) || null;
}

export async function getDirectorFilm(id: string | number, ownerKey: string): Promise<DirectorSession | null> {
  const response = await client().from(DIRECTOR_TABLE, { shared: true }).eq('id', id).eq('owner_key', ownerKey).limit(1).get();
  const row = rowData(response);
  return row ? rowToSession(row) : null;
}

export async function listDirectorFilms(ownerKey: string, limit = 12): Promise<DirectorFilmSummary[]> {
  const response = await client().from(DIRECTOR_TABLE, { shared: true })
    .eq('owner_key', ownerKey)
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .get();
  return ((response?.data || []) as any[]).map((row) => ({
    id: Number(row.id),
    title: String(row.title || 'Untitled Director film'),
    status: (String(row.status || 'draft') as DirectorStatus),
    script: String(row.script || ''),
    narrationUrl: String(row.narration_url || ''),
    filmUrl: String(row.film_url || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || row.created_at || ''),
  })).filter((film) => Number.isFinite(film.id));
}
