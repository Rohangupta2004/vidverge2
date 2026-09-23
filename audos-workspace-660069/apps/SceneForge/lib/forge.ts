/**
 * Client for the `sceneforge-v2` server function.
 *
 * The three SceneForge tables declare server-only columns — scenes protect
 * `render_url` and `remotion_code`, projects protect `assembled_video_url`,
 * `build_hash` and `checks`, assets protect `public_url`. A browser write that
 * carries one of them is refused with 403 WRITE_POLICY_DENIED, which is why
 * the app used to plan and approve scenes and then never show a picture.
 * Every privileged write, and image generation, goes through this hook.
 *
 * Plain reads still go straight to WorkspaceDB (see ./supabase).
 */
// Types only: `supabase.ts` imports this module back, so nothing here may be a
// runtime import from it.
import type { Asset, Project, Scene } from './supabase';

export const FORGE_HOOK = '/api/hooks/execute/workspace-660069/sceneforge-v2';

export interface ForgeProgress {
  scenes: number;
  images_ready: number;
  code_ready: number;
  assemble_ready: boolean;
}
export interface ForgeStatus {
  project: Project;
  scenes: Scene[];
  assets: Asset[];
  progress: ForgeProgress;
}

function sessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}
function token(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

/** The hook runner wraps every answer as { response, _meta }. */
function unwrap(payload: any): any {
  if (payload && typeof payload === 'object' && payload.response !== undefined && payload._meta !== undefined) return payload.response;
  return payload;
}

export interface MixResult { mixed: boolean; finalUrl?: string; pending?: boolean; note?: string }

export async function forge<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = token();
  const sid = sessionId();
  if (auth) headers['X-Workspace-DB-Token'] = auth;
  if (sid) headers['X-Session-Id'] = sid;
  const response = await fetch(FORGE_HOOK, { method: 'POST', headers, body: JSON.stringify({ op, session_id: sid, ...params }) });
  const data = unwrap(await response.json().catch(() => null));
  if (!response.ok || !data || data.success === false || data.error) {
    throw new Error(String((data && data.error) || `SceneForge did not answer (HTTP ${response.status}).`));
  }
  return data as T;
}

export const forgeApi = {
  status: (projectId: string) => forge<ForgeStatus>('status', { project_id: projectId }),
  // `partial: true` is the chunked-planning save: it upserts the scenes
  // planned so far WITHOUT deleting later rows and WITHOUT flipping the
  // project to scene_review, so an in-progress plan persists window by window.
  planScenes: (projectId: string, scenes: any[], options: { partial?: boolean } = {}) => forge<{ scenes: Scene[] }>('plan_scenes', { project_id: projectId, scenes, ...(options.partial ? { partial: true } : {}) }),
  addScene: (projectId: string, scene: Partial<Scene>) => forge<{ scene: Scene; scenes: Scene[] }>('add_scene', { project_id: projectId, scene }),
  saveScene: (projectId: string, sceneId: string, patch: Partial<Scene>) => forge<{ scene: Scene }>('save_scene', { project_id: projectId, scene_id: sceneId, patch }),
  deleteScene: (projectId: string, sceneId: string) => forge<{ scenes: Scene[] }>('delete_scene', { project_id: projectId, scene_id: sceneId }),
  saveProject: (projectId: string, patch: Partial<Project>) => forge<{ project: Project }>('save_project', { project_id: projectId, patch }),
  sceneImage: (projectId: string, sceneId: string, options: { prompt?: string; model?: string; style_prefix?: string; reuse?: boolean } = {}) =>
    forge<{ imageUrl: string; model: string; reused?: boolean; fallback_from?: string | null; fallback_reason?: string | null }>('scene_image', { project_id: projectId, scene_id: sceneId, ...options }),
  adoptUpload: (projectId: string, sceneId: string, publicUrl: string, elementName: string) =>
    forge<{ imageUrl: string }>('adopt_upload', { project_id: projectId, scene_id: sceneId, public_url: publicUrl, element_name: elementName }),
  music: (projectId: string, prompt?: string, lengthSec?: number) =>
    forge<{ musicUrl: string; durationMs: number; prompt: string }>('music', { project_id: projectId, prompt, length_s: lengthSec }),
  mixMusic: (projectId: string) => forge<MixResult>('mix_music', { project_id: projectId }),
  mixStatus: (projectId: string) => forge<MixResult>('mix_status', { project_id: projectId }),
};
