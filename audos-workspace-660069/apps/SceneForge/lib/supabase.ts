import type { OverlayConfig, VisualKind } from './effects';

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export type ProjectStatus = 'draft' | 'scripting' | 'script_review' | 'avatar_render' | 'style_choice' | 'scene_planning' | 'scene_review' | 'asset_gen' | 'coding' | 'assembling' | 'checks' | 'done' | 'editing';

/** The final-assembly job's lifecycle, persisted on the project row so Step 7 can rebuild its live panel after any reload. */
export type AssemblyStatus = 'idle' | 'preparing' | 'assembling' | 'checking' | 'completed' | 'failed' | 'cancelled';
export interface AssemblyJob {
  status: AssemblyStatus;
  /** 0–100. Moves DURING the render (estimated against the film's expected render time), never 0-then-100. */
  progress: number;
  /** The current operation, in plain words — e.g. "Preparing 11 video clips…", "Rendering the final MP4…". */
  message: string;
  started_at?: string;
  /** Heartbeat. A running job whose heartbeat is stale was orphaned by a closed tab and is failed on the next open. */
  updated_at?: string;
  finished_at?: string;
  output_url?: string;
  error?: string;
  /** The DirectorPlan draft version this render was submitted with — an output
   * of an older draft is shown but never promoted over a newer edit. */
  draft_version?: number;
}
export const ASSEMBLY_RUNNING_STATUSES: AssemblyStatus[] = ['preparing', 'assembling', 'checking'];
export function assemblyJobRunning(job?: AssemblyJob | null): boolean {
  return Boolean(job && ASSEMBLY_RUNNING_STATUSES.includes(job.status));
}
export interface Project {
  id: string; workspace_id: string; status: ProjectStatus; topic: string; audience?: string; language: string;
  target_length_sec: number; style?: string; aspect_ratio: '16:9' | '9:16'; script?: string; sources?: string[];
  estimated_duration_sec?: number; script_approved_at?: string;
  /** Cleared with null when HeyGen declares the render terminally failed, so reopening the project retries cleanly instead of resuming a dead render. */
  heygen_video_id?: string | null; heygen_video_url?: string;
  heygen_chunks?: any[]; word_timestamps?: WordTimestamp[]; avatar_duration_sec?: number; motion_bg_url?: string;
  // `render_operation_id` is cleared with null when a render stops being in
  // flight, so the column has to accept it.
  assembled_video_url?: string; checks?: CheckResult[]; render_operation_id?: string | null; build_hash?: string; editor_manifest?: any;
  /** Written only by the sceneforge-v2 server function. `final_video_url` is
   * cleared with null when a mix fails verification or a new assembled cut
   * supersedes the old mix, so the column has to accept it. */
  music_url?: string; music_prompt?: string; final_video_url?: string | null; stage_note?: string;
  /** How narration runs under middle visuals: 'continuous_heygen_voiceover' (default) — the avatar master's audio plays uninterrupted, documentary style. */
  audio_strategy?: string;
  /** Planning strategy, separate from the palette/typography style. */
  editing_preset?: string;
  /** Optional reference is analyzed for editing language only; no source assets are reused. */
  reference_video_url?: string; reference_style_analysis?: Record<string, unknown> | null;
  /** One post-assembly Opus review with per-scene weak-element suggestions. */
  qc_report?: { summary?: string; gaps?: string[]; overlaps?: string[]; suggestions?: Array<{ scene_id?: string; scene_index: number; weak: boolean; suggestion: string }> } | null;
  /** Live final-assembly job state — see AssemblyJob. Browser-writable (owner session); also passes through save_project. */
  assembly_job?: AssemblyJob | null;
  /** The AI Editorial Director's authoritative plan for the current generation (lib/directorPlan.DirectorPlan). */
  director_plan?: Record<string, unknown> | null;
  /** Id of the current plan generation — scenes/assets are stamped with it so stale work never leaks into a new render. */
  generation_id?: string | null;
  /** The last render that completed, verified and passed QA: { draft_version, generation_id, video_url, build_hash, promoted_at }. A failed render NEVER replaces this. */
  last_good_version?: Record<string, unknown> | null;
  /** Result of the last pre-render timeline validation (lib/timelineValidation). */
  timeline_report?: Record<string, unknown> | null;
  /** Film-level output QA for the assembled MP4 (lib/filmQa). */
  final_qa_report?: Record<string, unknown> | null;
}
export interface WordTimestamp { word: string; start: number; end: number }
export interface Scene {
  id: string; project_id: string; scene_index: number; script_start_sec: number; script_end_sec: number;
  scene_type: string; description: string; image_prompts: string[]; motion_notes?: string; suggested_user_uploads?: string[];
  // 'skipped' takes a failed supporting scene out of the film without
  // blocking the rest of the project.
  status: 'pending' | 'generating' | 'ready' | 'error' | 'skipped'; coding_status?: string; remotion_code?: string; render_url?: string; approved: boolean;
  /** How the scene is produced: 'ai_video' | 'text_graphics'. Null = legacy, treated as text_graphics. */
  visual_kind?: VisualKind | null;
  /** Timeline overlay definition (text, asset, preset effect) composed only at final assembly. */
  overlay_config?: OverlayConfig | null;
  /** For ai_video: the prompt last used (matching prompt = clip reused). For motion_graphic / text_overlay: the 'mg:' fingerprint of the spec the stored capture was recorded from. */
  video_prompt?: string | null;
  /** Structured motion-graphic scene spec (layout kind, title, items, stat…) written by the orchestrator. Deterministic source for the GSAP+SVG engine. */
  spec?: Record<string, unknown> | null;
  /** Native supporting-media audio stays under the uninterrupted HeyGen master. */
  audio_muted?: boolean; audio_volume?: number;
  /** Fields explicitly edited by the user; replanning preserves them. */
  user_locked_fields?: string[] | null;
  qc_weak?: boolean; qc_suggestion?: string | null;
  /** The Opus Motion Director's Visual Timeline JSON (see lib/visualTimeline):
   * per-layer hierarchy, entrance/exit timing, spatial zones, camera, and
   * scene transitions. Drives the directed GSAP render and the assembly
   * choreography; carries spec_fingerprint so an edited spec re-directs. */
  director_timeline?: Record<string, unknown> | null;
  /** Visual QA verdict for the captured clip (see lib/visualQa.SceneQaReport):
   * status pass/flagged/skipped, issues, summary. 'flagged' = auto-fix retries
   * exhausted — the scene ships its best render and the board shows why. */
  qa_report?: Record<string, unknown> | null;
  /** First-class EDITABLE overlay elements composed above the scene's visual
   * at assembly (lib/directorPlan.SceneOverlayElement[]). An overlay-only edit
   * re-renders the composition without regenerating any AI/HeyGen asset. */
  overlays?: Record<string, unknown>[] | null;
  /** Explicit presenter composition for this window (lib/directorPlan.PresenterState). */
  presenter_state?: Record<string, unknown> | null;
  /** Ken Burns / image motion for still scenes (lib/directorPlan.MotionTreatment). */
  motion_treatment?: Record<string, unknown> | null;
  /** The plan generation this scene's media belongs to. */
  generation_id?: string | null;
}
export interface Asset { id: string; project_id: string; scene_id?: string; asset_type: 'scene_image' | 'motion_bg' | 'user_upload'; element_name: string; storage_path: string; public_url?: string; prompt?: string; source: 'generated' | 'upload'; width?: number; height?: number }
export interface ForgeSettings {
  /** The ONE orchestrator LLM behind the whole pipeline: script, scene manifest, image/video prompts, Remotion scene data, overlays and change-request routing. There are no per-stage models. */
  id?: string; workspace_id: string; llm_model: string; image_model: string;
  /** Video engine for AI-video supporting scenes — the EXACT platform model id
   * (e.g. gemini-omni-flash-preview, veo-3.1-fast-generate-preview). */
  video_model?: string;
  heygen_api_key_secret_name: string; eleven_labs_voice_id?: string; default_avatar_id?: string; default_style?: string;
  default_language: string; default_target_length_sec: number; default_scene_share: 'low' | 'medium' | 'high'; default_aspect_ratio: '16:9' | '9:16'; heygen_defaults?: Record<string, unknown>;
}
export interface CheckResult { id: string; pass: boolean; label: string; detail: string }

export const DEFAULT_SETTINGS: ForgeSettings = {
  workspace_id: WORKSPACE_ID, llm_model: 'claude-opus-5', image_model: 'gemini-3.1-flash-image', video_model: 'gemini-omni-flash-preview',
  heygen_api_key_secret_name: 'HEYGEN_API_KEY', default_language: 'en', default_target_length_sec: 300, default_scene_share: 'medium', default_aspect_ratio: '9:16',
};

function db() {
  const client = (window as any).__workspaceDb;
  if (!client) throw new Error('SceneForge needs the workspace data runtime. Refresh and try again.');
  return client;
}
function rememberPlanningContext(project: Project | null) {
  if (typeof window === 'undefined' || !project) return project;
  (window as any).__sceneForgePlanningContext = { editingPreset: project.editing_preset || 'documentary', referenceStyleAnalysis: project.reference_style_analysis || null };
  return project;
}
export async function createProject(input: { topic: string; audience?: string; language: string; target_length_sec: number; aspect_ratio: '16:9' | '9:16'; editing_preset?: string; reference_video_url?: string; reference_style_analysis?: Record<string, unknown> }) {
  const remembered = typeof window !== 'undefined' ? ((window as any).__sceneForgePlanningContext || {}) : {};
  const result = await db().from('sceneforge_projects').insert({ workspace_id: WORKSPACE_ID, status: 'scripting', topic: input.topic, audience: input.audience || '', language: input.language, target_length_sec: input.target_length_sec, aspect_ratio: input.aspect_ratio, editing_preset: input.editing_preset || remembered.editingPreset || 'documentary', reference_video_url: input.reference_video_url || remembered.referenceVideoUrl || null, reference_style_analysis: input.reference_style_analysis || remembered.referenceStyleAnalysis || null });
  return rememberPlanningContext((result?.data?.[0] || result?.data || result) as Project) as Project;
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
export async function getProject(id: string) { const result = await db().from('sceneforge_projects').getById(id); return rememberPlanningContext((result?.data?.[0] || result?.data || null) as Project | null); }
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
export async function loadSettings(): Promise<ForgeSettings> {
  const result = await db().from('sceneforge_settings').eq('workspace_id', WORKSPACE_ID).limit(1).get();
  const row = result?.data?.[0] || {};
  // A settings row written before the single-LLM rework carries no llm_model;
  // its old script_model is the closest statement of intent.
  return { ...DEFAULT_SETTINGS, ...row, llm_model: row.llm_model || row.script_model || DEFAULT_SETTINGS.llm_model, video_model: row.video_model || DEFAULT_SETTINGS.video_model };
}
export async function saveSettings(settings: ForgeSettings) {
  const payload = {
    workspace_id: WORKSPACE_ID,
    llm_model: settings.llm_model,
    image_model: settings.image_model,
    video_model: settings.video_model || 'gemini-omni-flash-preview',
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
