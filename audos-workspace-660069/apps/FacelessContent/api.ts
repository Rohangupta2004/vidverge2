/**
 * FACELESS CONTENT — the network layer.
 *
 * Everything this app talks to, in one place:
 *
 *   The writer     POST /proxy/anthropic/v1/messages   research + script, and
 *                  POST /proxy/openai/v1/chat/completions  one shot prompt per
 *                                                        VISUAL line. A ladder
 *                                                        of models, not one —
 *                                                        see "The writer" below.
 *   Omni Flash /    POST /api/veo/generate/video         via lib/videoEngineClient,
 *   Veo 3.1 Fast                                         which also handles the
 *                                                        credit gate and refunds
 *   Runway Turbo    the fc-pipeline server function, which calls Runway on the
 *                   FOUNDER'S OWN RUNWAY_API_KEY through the secrets proxy
 *   Frames          POST /api/video/frames               last frame of a clip,
 *                                                        used to seed the next
 *   Stitch          POST /api/workspaces/:id/videos/stitch
 *
 * Two endpoint notes worth keeping, because the obvious guesses are wrong:
 * frame extraction is `/api/video/frames` (not a workspace-scoped path), and
 * stitching IS workspace-scoped — `window.__WORKSPACE_ID__` is not always
 * injected, so the id is resolved from the server function and cached.
 */

import { pollGroupA, submitGroupA } from '../../lib/videoEngineClient';
import { APP_IDS, OMNI_FLASH_MODEL, VEO_31_FAST_MODEL } from '../../lib/appIds';
import { generateVideoClip, type VideoIntegrationId } from '../../lib/videoIntegrations';
import { generateImage } from '../../lib/reelioStudio';
import {
  Niche, Orientation, SKIP_MARKER, TOPIC_SYSTEM, VIDEO_PROMPT_SYSTEM,
  scriptSystemPrompt, scriptUserPrompt, topicUserPrompt, videoPromptUser,
} from './prompts';

// ---------------------------------------------------------------------------
// Identity + plumbing
// ---------------------------------------------------------------------------

export function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

export function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  const w = window as any;
  return String(w.__APP_ID__ || w.__SPACE_ID__ || 'workspace-660069');
}

export function sessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}

export async function callHook(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/hooks/execute/${appId()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
      ...(sessionId() ? { 'X-Session-Id': sessionId() } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined
    ? raw.response
    : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  return data;
}

let workspaceIdCache: string | null = null;

/** The workspace UUID the stitch route needs. Injected when available, asked for otherwise. */
export async function resolveWorkspaceId(): Promise<string> {
  if (workspaceIdCache) return workspaceIdCache;
  const injected = typeof window !== 'undefined' ? (window as any).__WORKSPACE_ID__ : null;
  if (typeof injected === 'string' && injected) {
    workspaceIdCache = injected;
    return injected;
  }
  const data = await callHook('fc-pipeline', { op: 'context' });
  const id = String(data?.workspaceId || '');
  if (!id) throw new Error('This workspace could not be identified, so the film cannot be assembled.');
  workspaceIdCache = id;
  return id;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The writer
//
// Every text call used to be one un-timed POST to Claude Opus 5 with adaptive
// thinking, and that is what stalled the shot-prompt stage. Opus 5 cannot
// switch thinking off, and its reasoning tokens come out of the SAME
// `max_tokens` budget as the answer — so a 2,048-token budget was routinely
// spent inside the thinking block and the reply came back carrying no text at
// all. That happened once per scene, nine times in a row, and each failure was
// swallowed into the scene row where nobody could see it. With no timeout, no
// retry and no second model, a slow or silent proxy left the stage sitting on
// its last printed line for good.
//
// So a call is now a LADDER: each attempt is bounded by a timeout and retried
// once on a transient failure, and a model that cannot answer hands over to
// the next one. `onFallback` reports every step down, so the run says out loud
// which model actually wrote the text instead of failing quietly.
// ---------------------------------------------------------------------------

export interface WriterModel {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai';
  /** Opus 5 cannot switch thinking off; every other tier runs without it. */
  thinking: boolean;
}

/** Frontier first — the script is one long piece of research and reasoning. */
export const SCRIPT_LADDER: WriterModel[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', thinking: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', thinking: false },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6', provider: 'openai', thinking: false },
];

/**
 * A shot prompt is a mechanical transformation of one VISUAL line, so it
 * starts on the balanced tier with thinking disabled: no reasoning budget
 * competing with the answer, and fourteen of them finish in seconds instead of
 * minutes. Opus stays on the ladder as the escalation, not as the default.
 */
export const PROMPT_LADDER: WriterModel[] = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', thinking: false },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', thinking: true },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6', provider: 'openai', thinking: false },
];

/** The proxy ceiling. A thinking model spends its reasoning out of the same
 * budget, so a structured reply is never handed less than the whole of it. */
const MAX_OUTPUT_TOKENS = 8192;
const WRITER_TIMEOUT_MS = 150000;

class WriterError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'WriterError';
    this.retryable = retryable;
  }
}

async function postWriter(url: string, body: unknown): Promise<{ res: Response; data: any }> {
  const token = wsToken();
  if (!token) throw new WriterError('the workspace session is still loading', true);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), WRITER_TIMEOUT_MS) : 0;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    return { res, data: await res.json().catch(() => null) };
  } catch (e: any) {
    const aborted = Boolean(controller?.signal.aborted) || /abort/i.test(String(e?.message || e));
    throw new WriterError(
      aborted
        ? `it did not answer within ${Math.round(WRITER_TIMEOUT_MS / 1000)}s`
        : `the connection failed (${String(e?.message || e)})`,
      true,
    );
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function httpFailure(res: Response, data: any): WriterError {
  const code = String(data?.code || data?.error?.type || '');
  const detail = String(
    data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`,
  );
  return new WriterError(`${detail}${code ? ` [${code}]` : ''}`, res.status === 429 || res.status >= 500);
}

function claudeText(data: any): string {
  return Array.isArray(data?.content)
    ? data.content.filter((b: any) => b && b.type === 'text').map((b: any) => String(b.text || '')).join('')
    : '';
}

async function callAnthropic(model: WriterModel, system: string, user: string, maxTokens: number): Promise<string> {
  const base: Record<string, unknown> = {
    model: model.id,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  const reasoning = model.thinking
    ? { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } }
    : { thinking: { type: 'disabled' } };

  let answer = await postWriter('/proxy/anthropic/v1/messages', { ...base, ...reasoning });
  // Some proxy builds do not forward the reasoning controls; a rejection that
  // names them is retried once without them rather than losing the call.
  if (!answer.res.ok && answer.res.status === 400
    && /unsupported_field|output_config|thinking/i.test(JSON.stringify(answer.data || ''))) {
    answer = await postWriter('/proxy/anthropic/v1/messages', base);
  }
  if (!answer.res.ok) throw httpFailure(answer.res, answer.data);

  const text = claudeText(answer.data).trim();
  if (text) return text;
  // An empty reply from a thinking model means the budget went to reasoning
  // and the answer never started — only a different model gets past that.
  throw new WriterError(
    String(answer.data?.stop_reason) === 'max_tokens'
      ? 'it spent its whole token budget before writing an answer'
      : 'it returned an empty reply',
    false,
  );
}

async function callOpenAi(model: WriterModel, system: string, user: string, maxTokens: number): Promise<string> {
  const { res, data } = await postWriter('/proxy/openai/v1/chat/completions', {
    model: model.id,
    reasoning_effort: 'none',
    max_completion_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    stream: false,
  });
  if (!res.ok) throw httpFailure(res, data);
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new WriterError('it returned an empty reply', false);
  return text;
}

export interface WriteTextInput {
  system: string;
  user: string;
  maxTokens?: number;
  ladder?: WriterModel[];
  /** Announced on every step down, so the UI can name the model that wrote it. */
  onFallback?: (message: string) => void;
}

export async function writeText(input: WriteTextInput): Promise<string> {
  const ladder = input.ladder && input.ladder.length ? input.ladder : SCRIPT_LADDER;
  const maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(512, input.maxTokens || MAX_OUTPUT_TOKENS));
  const refusals: string[] = [];

  for (let i = 0; i < ladder.length; i += 1) {
    const model = ladder[i];
    let reason = 'it did not answer';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return model.provider === 'openai'
          ? await callOpenAi(model, input.system, input.user, maxTokens)
          : await callAnthropic(model, input.system, input.user, maxTokens);
      } catch (e: any) {
        reason = String(e?.message || e);
        if (attempt === 2 || !(e instanceof WriterError) || !e.retryable) break;
        await sleep(1500 * attempt);
      }
    }
    refusals.push(`${model.label} — ${reason}`);
    const next = ladder[i + 1];
    if (next) input.onFallback?.(`${model.label} could not write this (${reason}) — switching to ${next.label}.`);
  }
  throw new Error(`No writer could produce this text. ${refusals.join(' · ')}`);
}

export function researchAndScript(
  topic: string,
  niche: Niche,
  minutes: number,
  onFallback?: (message: string) => void,
): Promise<string> {
  return writeText({
    system: scriptSystemPrompt(niche, minutes),
    user: scriptUserPrompt(topic, niche, minutes),
    ladder: SCRIPT_LADDER,
    onFallback,
  });
}

export async function writeVideoPrompt(input: {
  visual: string;
  blockName: string;
  treatment: string;
  orientation: Orientation;
  durationSeconds: number;
  continuity?: string | null;
  onFallback?: (message: string) => void;
}): Promise<string> {
  const text = await writeText({
    system: VIDEO_PROMPT_SYSTEM,
    user: videoPromptUser(input),
    ladder: PROMPT_LADDER,
    onFallback: input.onFallback,
  });
  return text.trim();
}

export function isSkipPrompt(prompt: string): boolean {
  return String(prompt || '').trim().toUpperCase() === SKIP_MARKER;
}

export async function suggestTopic(niche: Niche): Promise<string> {
  const text = await writeText({
    system: TOPIC_SYSTEM,
    user: topicUserPrompt(niche),
    maxTokens: 2048,
    ladder: PROMPT_LADDER,
  });
  return text.split('\n')[0].replace(/^["“']+/, '').replace(/["”'.]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// Frames — last-frame seeding
// ---------------------------------------------------------------------------

/**
 * The last frame of a finished clip, as a public PNG. Sampled a fraction
 * before the end because asking for the exact duration lands past the final
 * decodable frame on some encodes and comes back empty.
 */
export async function extractLastFrame(videoUrl: string, durationSeconds: number): Promise<string | null> {
  const timestamp = Math.max(0.1, Number(durationSeconds) - 0.2);
  try {
    const workspaceId = await resolveWorkspaceId().catch(() => '');
    const payload: Record<string, unknown> = { videoUrl, timestamps: [timestamp] };
    if (workspaceId) payload.workspaceId = workspaceId;
    const res = await fetch('/api/video/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    const url = Array.isArray(data?.frames) ? data.frames[0]?.url : null;
    return typeof url === 'string' && url ? url : null;
  } catch (e) {
    console.warn('[FacelessContent] last-frame extraction failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scene generation
// ---------------------------------------------------------------------------

/** @deprecated Legacy brief values — new runs use videoIntegration + videoModel. */
export type VideoModel = 'omni_flash' | 'veo3' | 'runway_turbo';

/**
 * Gemini Omni Flash — the default engine, because this app films scene N from
 * the last frame of scene N-1 and Omni Flash is the one Group A model that
 * accepts a seed image and reference images together, which is what carries a
 * face, product or set across a cut.
 *
 * `gemini-omni-flash-preview` is the ONLY Omni Flash id the video proxy's
 * model enum accepts (integrations/image-and-video-generation/docs.md lists
 * the full enum); a versioned spelling answers 400 invalid_enum_value.
 */
// TODO: upgrade to 1.1 when platform key is confirmed
export const OMNI_MODEL = OMNI_FLASH_MODEL;

/** Veo 3.1 Fast — the cinematic tier, still selectable in the brief. */
export const VEO_MODEL = VEO_31_FAST_MODEL;

/** The Group A model id a picker engine renders on. */
export function groupAModelFor(engine: VideoModel): string {
  return engine === 'veo3' ? VEO_MODEL : OMNI_MODEL;
}

export interface SceneRenderResult {
  videoUrl: string;
  engine: string;
}

/** Keep every provider submission below its hard 1,000-character ceiling.
 * Prefer a complete sentence near the limit, then a complete word. */
export function safePrompt(prompt: string, limit = 950): string {
  const value = String(prompt || '').trim();
  if (value.length <= limit) return value;

  const truncated = value.slice(0, limit);
  let sentenceEnd = -1;
  for (const match of truncated.matchAll(/[.!?](?=\s|$)/g)) {
    sentenceEnd = match.index ?? sentenceEnd;
  }
  const minimumCleanCut = Math.floor(limit * 0.8);
  if (sentenceEnd >= minimumCleanCut) return truncated.slice(0, sentenceEnd + 1).trimEnd();

  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

/** One scene through the selected native Audos video integration. */
export async function renderSceneWithIntegration(input: {
  integration: VideoIntegrationId;
  model: string;
  prompt: string;
  orientation: Orientation;
  durationSeconds: number;
  seedFrameUrl?: string | null;
  onProgress?: (percent: number) => void;
  isCancelled?: () => boolean;
}): Promise<SceneRenderResult> {
  const prompt = safePrompt(input.prompt);
  const videoUrl = await generateVideoClip({
    integration: input.integration,
    model: input.model,
    prompt,
    aspectRatio: input.orientation,
    duration: Math.max(4, Math.min(10, Math.round(input.durationSeconds))),
    imageData: input.seedFrameUrl || undefined,
    appId: 'faceless-content',
    onProgress: input.onProgress,
  });
  if (input.isCancelled?.()) throw new Error('This generation was cancelled.');
  return { videoUrl, engine: input.model };
}

/** One scene on the Google video proxy, optionally seeded from the previous
 * scene's last frame. Defaults to Omni Flash. */
export async function renderSceneOnGoogle(input: {
  prompt: string;
  orientation: Orientation;
  durationSeconds: number;
  seedFrameUrl?: string | null;
  model?: string;
  onProgress?: (percent: number) => void;
  isCancelled?: () => boolean;
}): Promise<SceneRenderResult> {
  const model = input.model || OMNI_MODEL;
  const prompt = safePrompt(input.prompt);
  const kickoff = await submitGroupA({
    appId: APP_IDS.facelessContent,
    model,
    prompt,
    aspectRatio: input.orientation,
    duration: Math.max(4, Math.min(10, Math.round(input.durationSeconds))),
    generateAudio: true,
    resolution: '1080p',
    imageData: input.seedFrameUrl || undefined,
  });
  const videoUrl = await pollGroupA(kickoff.operationId, {
    creditKey: kickoff.creditKey,
    onProgress: input.onProgress,
    isCancelled: input.isCancelled,
    appId: APP_IDS.facelessContent,
  });
  return { videoUrl, engine: model };
}

/** Why a Runway render could not run — each needs a different thing said. */
export type RunwayFallbackReason = 'missing_key' | 'host_not_allowed' | 'rejected' | 'error';

export class RunwayUnavailableError extends Error {
  reason: RunwayFallbackReason;
  constructor(reason: RunwayFallbackReason, message: string) {
    super(message);
    this.name = 'RunwayUnavailableError';
    this.reason = reason;
  }
}

export function runwayFallbackMessage(reason: RunwayFallbackReason): string {
  if (reason === 'missing_key') return 'Runway API key not configured — switching to Omni Flash';
  if (reason === 'host_not_allowed') return 'RUNWAY_API_KEY is not allow-listed for api.dev.runwayml.com — switching to Omni Flash';
  if (reason === 'rejected') return 'Runway rejected the saved API key — switching to Omni Flash';
  return 'Runway could not be reached — switching to Omni Flash';
}

/**
 * Runway Gen-4 Turbo. It is image-to-video only, so scene 1 (which has no
 * previous frame to seed from) gets a still generated from its own shot
 * prompt first, and that still becomes the init image.
 */
export async function renderSceneWithRunway(input: {
  prompt: string;
  orientation: Orientation;
  durationSeconds: number;
  seedFrameUrl?: string | null;
  onNote?: (note: string) => void;
  isCancelled?: () => boolean;
}): Promise<SceneRenderResult> {
  const prompt = safePrompt(input.prompt);
  let initImage = input.seedFrameUrl || '';
  if (!initImage) {
    input.onNote?.('Drawing the opening frame…');
    initImage = await generateImage({
      prompt: safePrompt(prompt, 900),
      aspectRatio: input.orientation === '9:16' ? '9:16' : '16:9',
      quality: 'high',
      // The highest image tier /api/generate/image accepts as an override; it
      // falls back to gpt-image-1.5 on its own, so this never dead-ends.
      model: 'gpt-image-2',
      appId: APP_IDS.facelessContent,
    });
  }

  const submit = await callHook('fc-pipeline', {
    op: 'runway_submit',
    prompt,
    initImage,
    orientation: input.orientation,
    duration: Math.max(5, Math.min(10, Math.round(input.durationSeconds))),
  });
  if (!submit?.ok) {
    throw new RunwayUnavailableError(
      (submit?.reason as RunwayFallbackReason) || 'error',
      String(submit?.message || 'Runway did not accept the job.'),
    );
  }

  const taskId = String(submit.taskId);
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    if (input.isCancelled?.()) throw new Error('This generation was cancelled.');
    await sleep(5000);
    const status = await callHook('fc-pipeline', { op: 'runway_status', taskId });
    if (!status?.ok) {
      throw new RunwayUnavailableError(
        (status?.reason as RunwayFallbackReason) || 'error',
        String(status?.message || 'Runway stopped answering.'),
      );
    }
    const state = String(status.status || 'RUNNING').toUpperCase();
    if (state === 'SUCCEEDED' && status.videoUrl) return { videoUrl: String(status.videoUrl), engine: 'gen4_turbo' };
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new RunwayUnavailableError('error', `Runway ended ${state.toLowerCase()}${status.failure ? `: ${status.failure}` : ''}.`);
    }
    input.onNote?.(`Runway: ${state.toLowerCase()}…`);
  }
  throw new RunwayUnavailableError('error', 'The Runway job is taking unusually long — it may still finish; do not resubmit.');
}

// ---------------------------------------------------------------------------
// Stitching
// ---------------------------------------------------------------------------

/**
 * Concatenate the ordered scene clips into the final MP4. Tried from the page
 * first, because a long stitch can outlast a server function's own fetch
 * ceiling, then through the server function as a fallback.
 */
export async function stitchScenes(videoUrls: string[]): Promise<string> {
  const clips = videoUrls.filter((u) => typeof u === 'string' && u.indexOf('http') === 0);
  if (clips.length === 1) return clips[0];
  if (clips.length < 2) throw new Error('No finished scenes to assemble.');

  let directError = '';
  try {
    const workspaceId = await resolveWorkspaceId();
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/videos/stitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
      body: JSON.stringify({ videoUrls: clips }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.stitchedUrl) return String(data.stitchedUrl);
    directError = String(data?.error || `HTTP ${res.status}`);
  } catch (e: any) {
    directError = String(e?.message || e);
  }

  const viaHook = await callHook('fc-pipeline', { op: 'stitch', videoUrls: clips });
  const url = viaHook?.stitchedUrl;
  if (typeof url !== 'string' || !url) {
    throw new Error(`The scenes could not be assembled into one film (${directError}).`);
  }
  return url;
}
