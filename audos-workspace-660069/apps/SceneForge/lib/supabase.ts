export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export type ProjectStatus = 'draft' | 'scripting' | 'script_review' | 'avatar_render' | 'style_choice' | 'scene_planning' | 'scene_review' | 'asset_gen' | 'coding' | 'assembling' | 'checks' | 'done' | 'editing';
export interface Project {
  id: string; workspace_id: string; status: ProjectStatus; topic: string; audience?: string; language: string;
  target_length_sec: number; style?: string; aspect_ratio: '16:9' | '9:16'; script?: string; sources?: string[];
  estimated_duration_sec?: number; script_approved_at?: string; heygen_video_id?: string; heygen_video_url?: string;
  heygen_chunks?: any[]; word_timestamps?: WordTimestamp[]; avatar_duration_sec?: number; motion_bg_url?: string;
  // `render_operation_id` is cleared with null when a render stops being in
  // flight, so the column has to accept it.
  assembled_video_url?: string; checks?: CheckResult[]; render_operation_id?: string | null; build_hash?: string; editor_manifest?: any;
  /** Written only by the sceneforge-v2 server function. */
  music_url?: string; music_prompt?: string; final_video_url?: string; stage_note?: string;
}
export interface WordTimestamp { word: string; start: number; end: number }
export interface Scene {
  id: string; project_id: string; scene_index: number; script_start_sec: number; script_end_sec: number;
  scene_type: string; description: string; image_prompts: string[]; motion_notes?: string; suggested_user_uploads?: string[];
  status: 'pending' | 'generating' | 'ready' | 'error'; coding_status?: string; remotion_code?: string; render_url?: string; approved: boolean;
}
export interface Asset { id: string; project_id: string; scene_id?: string; asset_type: 'scene_image' | 'motion_bg' | 'user_upload'; element_name: string; storage_path: string; public_url?: string; prompt?: string; source: 'generated' | 'upload'; width?: number; height?: number }
export interface ForgeSettings {
  id?: string; workspace_id: string; script_model: string; scene_decider_model: string; image_model: string; coding_model: string;
  heygen_api_key_secret_name: string; eleven_labs_voice_id?: string; default_avatar_id?: string; default_style?: string;
  default_language: string; default_target_length_sec: number; default_scene_share: 'low' | 'medium' | 'high'; default_aspect_ratio: '16:9' | '9:16'; heygen_defaults?: Record<string, unknown>;
}
export interface CheckResult { id: string; pass: boolean; label: string; detail: string }

export const DEFAULT_SETTINGS: ForgeSettings = {
  workspace_id: WORKSPACE_ID, script_model: 'claude-opus-5', scene_decider_model: 'claude-opus-5', image_model: 'gpt-image-2', coding_model: 'claude-sonnet-5',
  heygen_api_key_secret_name: 'HEYGEN_API_KEY', default_language: 'en', default_target_length_sec: 300, default_scene_share: 'medium', default_aspect_ratio: '16:9',
};

function db() {
  const client = (window as any).__workspaceDb;
  if (!client) throw new Error('SceneForge needs the workspace data runtime. Refresh and try again.');
  return client;
}
export async function createProject(input: { topic: string; audience?: string; language: string; target_length_sec: number; aspect_ratio: '16:9' | '9:16' }) {
  const result = await db().from('sceneforge_projects').insert({ workspace_id: WORKSPACE_ID, status: 'scripting', topic: input.topic, audience: input.audience || '', language: input.language, target_length_sec: input.target_length_sec, aspect_ratio: input.aspect_ratio });
  return (result?.data?.[0] || result?.data || result) as Project;
}
// `assembled_video_url`, `build_hash`, `checks`, `music_url` and
// `final_video_url` are server-only columns: a browser update that carries one
// is refused with 403 WRITE_POLICY_DENIED and the whole patch is lost. Any
// patch touching them goes through the server function; everything else keeps
// the direct write so ordinary edits stay instant.
const SERVER_ONLY_PROJECT_FIELDS = ['assembled_video_url', 'build_hash', 'checks', 'music_url', 'music_prompt', 'final_video_url', 'stage_note'];
export async function updateProject(id: string, patch: Partial<Project>) {
  const needsServer = Object.keys(patch).some((key) => SERVER_ONLY_PROJECT_FIELDS.includes(key));
  if (needsServer) { const { forgeApi } = await import('./forge'); await forgeApi.saveProject(id, patch); return; }
  await db().from('sceneforge_projects').update(id, patch);
}
export async function getProject(id: string) { const result = await db().from('sceneforge_projects').getById(id); return (result?.data?.[0] || result?.data || null) as Project | null; }
export async function listProjects() { const result = await db().from('sceneforge_projects').orderBy('updated_at', 'desc').limit(50).get(); return (result?.data || []) as Project[]; }
export async function listScenes(projectId: string) { const result = await db().from('sceneforge_scenes').eq('project_id', projectId).orderBy('scene_index', 'asc').get(); return (result?.data || []) as Scene[]; }
// Scene writes are owned by the server function. `sceneforge_scenes` has a
// UNIQUE index on (project_id, scene_index) and protects render_url and
// remotion_code, so a browser insert races that index and a browser update
// silently loses the picture. The hook resolves the row by index and updates
// it in place instead.
export async function insertScene(scene: Omit<Scene, 'id'>) {
  const { forgeApi } = await import('./forge');
  const result = await forgeApi.addScene(scene.project_id, scene as Partial<Scene>);
  return (result.scene || result.scenes?.[result.scenes.length - 1]) as Scene;
}
export async function savePlan(projectId: string, scenes: any[]) {
  const { forgeApi } = await import('./forge');
  const result = await forgeApi.planScenes(projectId, scenes);
  return (result.scenes || []) as Scene[];
}
async function projectIdOf(sceneId: string, known?: string) {
  if (known) return known;
  const result = await db().from('sceneforge_scenes').getById(sceneId);
  const row = (result?.data?.[0] || result?.data || null) as Scene | null;
  if (!row?.project_id) throw new Error('That scene is no longer in this project. Reopen the project and try again.');
  return row.project_id;
}
export async function updateScene(id: string, patch: Partial<Scene>, projectId?: string) {
  const { forgeApi } = await import('./forge');
  await forgeApi.saveScene(await projectIdOf(id, projectId), id, patch);
}
export async function removeScene(id: string, projectId?: string) {
  const { forgeApi } = await import('./forge');
  await forgeApi.deleteScene(await projectIdOf(id, projectId), id);
}
export async function listAssets(projectId: string) { const result = await db().from('sceneforge_assets').eq('project_id', projectId).get(); return (result?.data || []) as Asset[]; }
export async function insertAsset(asset: Omit<Asset, 'id'>) { const result = await db().from('sceneforge_assets').insert(asset); return (result?.data?.[0] || result?.data || result) as Asset; }
export async function loadSettings(): Promise<ForgeSettings> { const result = await db().from('sceneforge_settings').eq('workspace_id', WORKSPACE_ID).limit(1).get(); return { ...DEFAULT_SETTINGS, ...(result?.data?.[0] || {}) }; }
export async function saveSettings(settings: ForgeSettings) {
  const payload = {
    workspace_id: WORKSPACE_ID,
    script_model: settings.script_model,
    scene_decider_model: settings.scene_decider_model,
    image_model: settings.image_model,
    coding_model: settings.coding_model,
    heygen_api_key_secret_name: settings.heygen_api_key_secret_name,
    eleven_labs_voice_id: settings.eleven_labs_voice_id || '',
    default_avatar_id: settings.default_avatar_id || '',
    default_style: settings.default_style || '',
    default_language: settings.default_language,
    default_target_length_sec: settings.default_target_length_sec,
    default_scene_share: settings.default_scene_share,
    default_aspect_ratio: settings.default_aspect_ratio,
    heygen_defaults: settings.heygen_defaults || {},
  };
  if (settings.id) await db().from('sceneforge_settings').update(settings.id, payload);
  else await db().from('sceneforge_settings').insert(payload);
}
