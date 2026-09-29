// Product Videos — the headless URL-to-Published-MP4 render job.
//
// SERVER PIPELINE (the pv-ad-director server function — hook code cannot
// import workspace files, so this module is the browser-side dispatcher and
// the readable contract). One pv_projects row (mode 'ad') per job; one unit
// of work per tick; every asset URL persisted the moment it exists; one
// fire-and-forget self-invoke between ticks; staggered hourly task-scheduler
// sweeps rescue any run whose chain died. THE USER CAN CLOSE THE BROWSER THE
// MOMENT startAdJob RESOLVES — nothing after that needs a tab.
//
// STATUS LADDER (pv_projects.status):
//   queued → directing   scrape the URL + gpt-5.6-terra 3-beat script.
//                        Screenshots are REAL ONLY: lifted off the page,
//                        captured with a headless browser, or uploaded by the
//                        founder — never AI-generated mockups.
//          → voiceover   ElevenLabs MP3s + Deepgram word timestamps
//          → backdrop    google-veo3 ambient plate (photoreal atmosphere ONLY
//                        — the UI screenshot is composited by Remotion)
//          → composing   the Remotion-specialist coding agent (gpt-5.6-sol)
//                        WRITES the composition from the chosen style preset's
//                        detailed brief + the WEBSITE'S OWN colour theme + the
//                        narration transcript (timing is voice-derived).
//                        There is NO hardcoded fallback template.
//          → preview     THE STUDIO GATE: the cut plays in the in-app Remotion
//                        studio; NOTHING renders on the server until the
//                        founder approves — or they ask the agent for changes
//                        and a fresh cut comes back to this preview.
//          → rendering   (only after approval) POST /api/render/remotion
//                        (1920x1080 @ 30fps) → MP4 lands on GCS; a rejected
//                        render goes BACK to the coding agent with the error
//          → completed | failed (with the real exception text)
// pv_projects.stage carries the human-readable progress line verbatim.
//
// Music bed: read from the shared pv_music_tracks cache (generated once,
// reused forever); ducked -12 dB under the voiceover by the composition.

import { callAdHook, type AdProductSummary } from './director';
import { resolveSessionId } from './pipeline';

export interface AdProjectRow {
  id: number;
  title: string | null;
  mode: string;
  status: string;
  stage: string | null;
  error: string | null;
  brief: any;
  plan: any;
  assets: any;
  audio: any;
  music_track: number | null;
  duration_frames: number | null;
  composition_tsx?: string | null;
  render_operation_id: string | null;
  video_url: string | null;
  updated_at?: string;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Dispatch — create the pv_projects row and start the server chain.
// ---------------------------------------------------------------------------

/**
 * Queue the whole URL→MP4 production server-side. Returns the project id the
 * studio polls; the browser is free to close as soon as this resolves.
 * A REAL screenshot must be on the summary (scraped, captured, or uploaded) —
 * the server refuses to start without one rather than drawing an AI mockup.
 */
export async function startAdJob(
  url: string,
  summary?: AdProductSummary | null,
  stylePreset?: string,
): Promise<number> {
  const data = await callAdHook<{ projectId: number }>({
    op: 'create',
    url: url.trim(),
    summary: summary || undefined,
    stylePreset: stylePreset || 'auto',
  });
  const projectId = Number(data?.projectId);
  if (!projectId) throw new Error('The ad project could not be created.');
  return projectId;
}

/** Clear a failed run's outputs and send it back through the pipeline. */
export async function retryAdJob(projectId: number): Promise<void> {
  await callAdHook({ op: 'retry', project_id: projectId });
}

/** Wake a run whose server-side chain died while nobody was watching. */
export async function nudgeAdJob(projectId: number): Promise<void> {
  await callAdHook({ op: 'status', project_id: projectId });
}

/** The founder watched the preview and wants the final MP4 — render now. */
export async function approveAdRender(projectId: number): Promise<void> {
  await callAdHook({ op: 'approve-render', project_id: projectId });
}

/** Ask the coding agent for changes; a fresh cut returns to the preview. */
export async function reviseAdJob(projectId: number, note: string): Promise<void> {
  await callAdHook({ op: 'revise', project_id: projectId, note });
}

// ---------------------------------------------------------------------------
// Reads — the studio polls the pv_projects row (see lib/studio.ts).
// ---------------------------------------------------------------------------

function runtime(): any {
  return typeof window === 'undefined' ? {} : (window as any);
}

/** Read one project row straight from WorkspaceDB — this is the poll. */
export async function readAdProject(projectId: number): Promise<AdProjectRow | null> {
  const db = runtime().__workspaceDb;
  if (!db) return null;
  const result = await db.from('pv_projects').getById(projectId);
  const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
  return (row as AdProjectRow) || null;
}

/** List this visitor's ad projects, newest first (session-scoped). */
export async function listAdProjects(limit = 24): Promise<AdProjectRow[]> {
  const db = runtime().__workspaceDb;
  const sessionId = resolveSessionId();
  if (!db || !sessionId) return [];
  const { data } = await db
    .from('pv_projects')
    .eq('session_id', sessionId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  return Array.isArray(data) ? (data as AdProjectRow[]) : [];
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const LIVE_STATUSES = ['queued', 'directing', 'voiceover', 'backdrop', 'composing', 'rendering'];

export function isAdJobLive(status: unknown): boolean {
  return LIVE_STATUSES.indexOf(String(status || '')) >= 0;
}

/** Waiting on the founder in the preview studio — not live, not finished. */
export function isAdJobPreview(status: unknown): boolean {
  return String(status || '') === 'preview';
}

export function isAdJobDone(status: unknown): boolean {
  const value = String(status || '');
  return value === 'completed' || value === 'complete';
}

export function isAdJobFailed(status: unknown): boolean {
  return String(status || '') === 'failed';
}

export type AdPhase = 'directing' | 'voiceover' | 'backdrop' | 'composing' | 'preview' | 'rendering' | 'done';

/** Map the server status onto the studio's progress stepper. */
export function adPhaseKey(project: AdProjectRow | null): AdPhase {
  const status = String(project?.status || 'queued');
  if (isAdJobDone(status)) return 'done';
  if (status === 'voiceover') return 'voiceover';
  if (status === 'backdrop') return 'backdrop';
  if (status === 'composing') return 'composing';
  if (status === 'preview') return 'preview';
  if (status === 'rendering') return 'rendering';
  return 'directing';
}

const STAGE_FALLBACKS: Record<string, string> = {
  queued: 'Queued — the server pipeline is picking this up…',
  directing: 'Reading your page and writing the 3-beat script…',
  voiceover: 'Recording the voiceover and timing every word…',
  backdrop: 'Filming the ambient backdrop plate…',
  composing: 'The Remotion coding agent is writing your composition…',
  preview: 'Preview ready — watch it, then approve the render or ask for changes.',
  rendering: 'Rendering your commercial on the server…',
  completed: 'Done ✓',
  complete: 'Done ✓',
};

/** The line the customer reads. The server writes it; this only fills gaps. */
export function adStageLabel(project: AdProjectRow | null): string {
  if (!project) return 'Starting…';
  if (isAdJobDone(project.status)) return 'Done ✓';
  const stage = String(project.stage || '').trim();
  if (stage) return stage;
  return STAGE_FALLBACKS[String(project.status)] || 'Working…';
}
