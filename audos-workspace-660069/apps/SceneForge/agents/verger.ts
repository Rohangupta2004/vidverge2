import { claudeJson } from '../lib/proxy';

export type VergerRoute = 'script' | 'scene' | 'style' | 'assembly';
export const VERGER_SYSTEM = `You are Verger, SceneForge's coordinator. Route a user's change request without doing unrelated work. Script wording or intro changes route to script. A numbered/timed visual change routes to scene. Global visual treatment routes to style. Timing, trim, logo, overlay or final-video changes route to assembly. Return strict JSON {"route":"script|scene|style|assembly","action":string,"affected_scene_indexes":number[]}. Never overwrite an active user edit: the caller will queue your intent until the user saves.`;
export async function routeVergerRequest(request: string, context: unknown) {
  return claudeJson<{ route: VergerRoute; action: string; affected_scene_indexes: number[] }>(VERGER_SYSTEM, { request, context }, 'claude-opus-5', 1200);
}
