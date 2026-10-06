// The Video Agent: SceneForge's primary generation path.
//
// One brief in, a finished film out. Two modes:
//   * one-shot  — HeyGen plans and renders without stopping.
//   * storyboard — HeyGen plans, PAUSES, and returns the scene breakdown for
//     the customer to read and edit before any render credit is spent. The
//     approval message then releases the render.
//
// Every submission carries the locked ids from lib/heygenSession, so scene 1
// and scene 9 are the same character, in the same brand, saying product names
// the same way. That is the whole point of the lock.
import { body, errorOf, get, jobIdOf, listOf, pollJob, post, probe, statusOf, urlOf, type PollOptions } from './heygenApi';
import { HeyGenError } from './heygenStudio';
import { getSession, lockedFields } from './heygenSession';

/** The webhook HeyGen calls when a job finishes. */
export function callbackUrl(): string {
  try {
    const spaceId = String((window as any).__SPACE_ID__ || (window as any).__APP_ID__ || '');
    if (!spaceId) return '';
    return `${window.location.origin}/api/hooks/execute/${spaceId}/sceneforge-heygen-webhook`;
  } catch { return ''; }
}

export interface StoryboardScene {
  id: string;
  index: number;
  title: string;
  description: string;
  /** Spoken line for the scene, when HeyGen separated it from the visual. */
  script: string;
  durationSec: number;
}

export interface AgentSubmission {
  /** The agent session/job id every later call references. */
  jobId: string;
  /** Populated in storyboard mode once HeyGen has planned the film. */
  storyboard: StoryboardScene[];
  /** Set when the render finished inside the first response (rare). */
  videoUrl: string;
  raw: any;
}

function storyboardFrom(payload: any): StoryboardScene[] {
  const data = body(payload);
  const raw = Array.isArray(data.scenes) ? data.scenes
    : Array.isArray(data.storyboard) ? data.storyboard
      : Array.isArray(data.storyboard?.scenes) ? data.storyboard.scenes
        : Array.isArray(data.plan?.scenes) ? data.plan.scenes
          : listOf(payload).filter((entry) => entry && (entry.description || entry.script || entry.title));
  return (raw || []).map((scene: any, index: number) => ({
    id: String(scene?.id || scene?.scene_id || `scene-${index + 1}`),
    index: Number(scene?.index ?? scene?.scene_index ?? index) || index,
    title: String(scene?.title || scene?.name || `Scene ${index + 1}`),
    description: String(scene?.description || scene?.visual || scene?.visual_description || scene?.prompt || ''),
    script: String(scene?.script || scene?.narration || scene?.voiceover || scene?.text || ''),
    durationSec: Number(scene?.duration || scene?.duration_sec || 0) || 0,
  }));
}

export interface GenerateInput {
  prompt: string;
  /** Asset handles for product shots / screenshots the film should use. */
  files: string[];
  /** Overrides the session orientation for this one submission. */
  orientation?: 'landscape' | 'portrait';
}

/**
 * Submit a brief to the Video Agent.
 *
 * MODE NAMES. Otto's brief specifies `one_shot` and `chat`; the platform's
 * own HeyGen documentation shows `generate`. Rather than guess which this
 * account accepts, the requested mode is sent first and a rejection that
 * names the mode field is retried once against the documented value. The
 * mode actually accepted is remembered so the second submission goes straight
 * there.
 */
let acceptedMode: Record<string, string> = {};

export async function submitVideoAgent(input: GenerateInput, storyboardMode: boolean): Promise<AgentSubmission> {
  const session = getSession();
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Write the brief first — what should this video say?');
  if (!session.avatarId) throw new Error('Lock a presenter first so every scene uses the same character.');

  const requested = storyboardMode ? 'chat' : 'one_shot';
  const fallback = storyboardMode ? 'chat' : 'generate';
  const callback = callbackUrl();

  const payloadFor = (mode: string) => ({
    prompt,
    mode,
    orientation: input.orientation || session.orientation,
    ...lockedFields(),
    ...(input.files.length ? { files: input.files } : {}),
    ...(session.transparentBackground ? { background: 'transparent' } : {}),
    ...(session.cinematicMode ? { cinematic: true } : {}),
    ...(callback ? { callback_url: callback } : {}),
  });

  const send = (mode: string) => probe('video-agents', 'The HeyGen Video Agent', () => post('v3/video-agents', payloadFor(mode)));

  let created: any;
  const known = acceptedMode[requested];
  try {
    created = await send(known || requested);
    acceptedMode = { ...acceptedMode, [requested]: known || requested };
  } catch (e) {
    const message = String((e as any)?.message || '');
    const modeRejected = Number((e as HeyGenError)?.status) === 400 && /mode/i.test(message);
    if (!modeRejected || known === fallback || requested === fallback) throw e;
    created = await send(fallback);
    acceptedMode = { ...acceptedMode, [requested]: fallback };
  }

  const jobId = jobIdOf(created);
  const storyboard = storyboardFrom(created);
  if (!jobId && !storyboard.length && !urlOf(created)) {
    throw new HeyGenError('HeyGen accepted the brief but returned nothing to track it by.');
  }
  return { jobId, storyboard, videoUrl: urlOf(created), raw: created };
}

/**
 * Read the agent session again — how a storyboard is collected when HeyGen
 * plans asynchronously rather than answering the submit call with scenes.
 */
export async function fetchAgentState(jobId: string): Promise<AgentSubmission> {
  const payload = await get(`v3/video-agents/${encodeURIComponent(jobId)}`);
  return { jobId, storyboard: storyboardFrom(payload), videoUrl: urlOf(payload), raw: payload };
}

/**
 * Wait for the storyboard in chat mode. HeyGen may return the scene plan in
 * the submit response or shortly after, so the session is re-read until
 * scenes appear.
 */
export async function awaitStoryboard(jobId: string, onTick?: (seconds: number) => void): Promise<StoryboardScene[]> {
  const started = Date.now();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await fetchAgentState(jobId);
    if (state.storyboard.length) return state.storyboard;
    if (state.videoUrl) return [];
    onTick?.(Math.round((Date.now() - started) / 1000));
    await new Promise((resolve) => window.setTimeout(resolve, 4000));
  }
  throw new HeyGenError('HeyGen did not return a storyboard in time. Switch off storyboard review to render in one shot.');
}

/**
 * Approve the plan and release the render.
 *
 * The edited scene descriptions are sent back with the approval so the
 * customer's edits are what gets rendered — approving a storyboard the
 * customer has rewritten and then rendering the original would be the worst
 * possible outcome of this feature.
 */
export async function approveStoryboard(jobId: string, scenes: StoryboardScene[], note: string): Promise<void> {
  const edited = scenes.map((scene) => ({
    id: scene.id,
    index: scene.index,
    title: scene.title,
    description: scene.description,
    ...(scene.script ? { script: scene.script } : {}),
  }));
  await probe('video-agents', 'The HeyGen Video Agent', () => post(`v3/video-agents/${encodeURIComponent(jobId)}/messages`, {
    message: note.trim() || 'Approved. Render this storyboard now.',
    action: 'approve',
    scenes: edited,
  }));
}

/**
 * ONE status read for an agent job.
 *
 * This is what lib/sfJobs calls as its direct fallback while it watches the
 * database row: a single request per cycle, so the webhook stays the fast
 * path and this only guarantees the job can never stall forever (a draft
 * preview origin HeyGen cannot call back into, for instance).
 */
export async function agentStatus(jobId: string): Promise<{ status: string; videoUrl: string; error: string }> {
  const payload = await get(`v3/video-agents/${encodeURIComponent(jobId)}`);
  const videoUrl = urlOf(payload);
  return {
    status: videoUrl ? 'completed' : (statusOf(payload) || 'processing'),
    videoUrl,
    error: errorOf(payload),
  };
}

/** Poll an agent job to its finished MP4. */
export function awaitAgentVideo(jobId: string, options: PollOptions = {}) {
  return pollJob(`v3/video-agents/${encodeURIComponent(jobId)}`, {
    label: 'Your video',
    intervalMs: 6000,
    timeoutMs: 25 * 60 * 1000,
    ...options,
  });
}

// ——— Batch ———

export interface BatchItem {
  /** Caller's own key, so a result can be matched back to its scene. */
  key: string;
  prompt: string;
  files?: string[];
}

export interface BatchSubmission {
  batchId: string;
  /** Per-item job ids, in the order submitted, when HeyGen returned them. */
  jobIds: string[];
}

export const BATCH_LIMIT = 100;

/**
 * Submit several scenes as ONE request.
 *
 * Used when a brief is broken into scenes: one round trip instead of N, which
 * is both faster and far less likely to trip HeyGen's rate limit. The caller
 * keeps the returned ids aligned with its own scene list by index.
 */
export async function submitBatch(items: BatchItem[], storyboardMode: boolean): Promise<BatchSubmission> {
  if (!items.length) throw new Error('There are no scenes to generate.');
  if (items.length > BATCH_LIMIT) throw new Error(`A batch holds at most ${BATCH_LIMIT} scenes — this one has ${items.length}.`);
  const session = getSession();
  if (!session.avatarId) throw new Error('Lock a presenter first so every scene in the batch uses the same character.');
  const callback = callbackUrl();

  const created = await probe('batch', 'Batch generation', () => post('v3/batch', {
    requests: items.map((item) => ({
      method: 'POST',
      path: '/v3/video-agents',
      body: {
        prompt: item.prompt,
        mode: storyboardMode ? 'chat' : 'one_shot',
        orientation: session.orientation,
        ...lockedFields(),
        ...(item.files?.length ? { files: item.files } : {}),
        ...(session.transparentBackground ? { background: 'transparent' } : {}),
        ...(session.cinematicMode ? { cinematic: true } : {}),
        ...(callback ? { callback_url: callback } : {}),
      },
    })),
  }));

  const data = body(created);
  const responses = Array.isArray(data.responses) ? data.responses : Array.isArray(data.results) ? data.results : listOf(created);
  return {
    batchId: String(data.batch_id || data.id || ''),
    jobIds: responses.map((entry: any) => jobIdOf(entry?.body ? entry : { data: entry })).map(String),
  };
}
