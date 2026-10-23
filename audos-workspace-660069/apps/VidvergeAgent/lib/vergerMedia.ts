import { getWorkspaceToken } from '../../../lib/workspace';

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
export const OMNI_EDIT_CREDITS = 8;
export const OMNI_MAX_CLIP_SECONDS = 8;

export type EditPhase =
  | 'idle'
  | 'trimming'
  | 'analysing'
  | 'prompting'
  | 'awaiting_approval'
  | 'editing'
  | 'splicing'
  | 'completed'
  | 'failed';

export interface EditWindow {
  startSec: number;
  endSec: number;
  timestampSec: number;
}

export interface EditProgress {
  phase: EditPhase;
  agent: string;
  detail: string;
}

export interface PreparedVisualEdit {
  sourceUrl: string;
  sourceDuration: number;
  clipUrl: string;
  window: EditWindow;
  frames: Array<{ timestamp: number; url: string }>;
  prompt: string;
  request: string;
}

export class VergerMediaError extends Error {
  category: 'auth' | 'credits' | 'provider_rejection' | 'format' | 'timeout' | 'bad_prompt' | 'unknown';
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'VergerMediaError';
    this.status = status;
    this.category = classifyMediaError(message, status);
  }
}

export function classifyMediaError(message: string, status = 0): VergerMediaError['category'] {
  const text = String(message || '').toLowerCase();
  if (status === 401 || status === 403 || /token|credential|auth|session/.test(text)) return 'auth';
  if (status === 402 || /credit|wallet|balance|fund/.test(text)) return 'credits';
  if (status === 408 || status === 504 || /timeout|timed out/.test(text)) return 'timeout';
  if (/mime|format|unsupported|duration|length|video input|videoData/i.test(text)) return 'format';
  if (/prompt|instruction|too short|too long/.test(text)) return 'bad_prompt';
  if (status >= 400 && status < 500) return 'provider_rejection';
  return 'unknown';
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function editWindowAt(timestampSec: number, durationSec: number): EditWindow {
  const duration = Math.max(0.01, Number(durationSec) || OMNI_MAX_CLIP_SECONDS);
  const point = Math.min(duration, Math.max(0, Number(timestampSec) || 0));
  const span = Math.min(OMNI_MAX_CLIP_SECONDS, duration);
  let startSec = Math.max(0, point - span / 2);
  let endSec = Math.min(duration, startSec + span);
  startSec = Math.max(0, endSec - span);
  return { startSec: rounded(startSec), endSec: rounded(endSec), timestampSec: rounded(point) };
}

async function tokenHeaders(json = true): Promise<Record<string, string>> {
  const token = await getWorkspaceToken();
  if (!token) throw new VergerMediaError('Workspace token unavailable. Sign in again before using provider tools.', 401);
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Workspace-DB-Token': token,
    'X-Audos-Workspace-Id': WORKSPACE_ID,
  };
}

async function responseJson(response: Response, fallback: string): Promise<any> {
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    const details = Array.isArray(body?.details)
      ? body.details.map((item: any) => item?.message).filter(Boolean).join('; ')
      : '';
    const message = body?.errorMessage || body?.error?.message || body?.error || details || `${fallback} (HTTP ${response.status})`;
    throw new VergerMediaError(String(message), response.status);
  }
  return body;
}

async function trimVideo(sourceUrl: string, startSec: number, endSec: number): Promise<string> {
  const response = await fetch('/api/video/clip', {
    method: 'POST',
    headers: await tokenHeaders(),
    body: JSON.stringify({ videoUrlOrKey: sourceUrl, startSec, endSec, workspaceId: WORKSPACE_ID }),
  });
  const body = await responseJson(response, 'Video trim failed');
  if (!body?.url) throw new VergerMediaError('Video trim returned no clip URL.');
  return String(body.url);
}

async function extractFrames(clipUrl: string, durationSec: number): Promise<Array<{ timestamp: number; url: string }>> {
  const end = Math.max(0.05, durationSec - 0.05);
  const timestamps = Array.from(new Set([0.05, durationSec * 0.25, durationSec * 0.5, durationSec * 0.75, end].map(rounded)));
  const response = await fetch('/api/video/frames', {
    method: 'POST',
    headers: await tokenHeaders(),
    body: JSON.stringify({ videoUrl: clipUrl, timestamps, workspaceId: WORKSPACE_ID }),
  });
  const body = await responseJson(response, 'Frame extraction failed');
  if (!Array.isArray(body?.frames) || !body.frames.length) throw new VergerMediaError('Frame extraction returned no frames.');
  return body.frames.map((frame: any) => ({ timestamp: Number(frame.timestamp) || 0, url: String(frame.url || '') })).filter((frame: any) => frame.url);
}

async function writeDetailedEditPrompt(
  frames: Array<{ timestamp: number; url: string }>,
  request: string,
  window: EditWindow,
): Promise<string> {
  const relative = rounded(window.timestampSec - window.startSec);
  const content: any[] = [
    {
      type: 'text',
      text: [
        'You are Verger Vision Reviewer. Write one production-ready source-video edit instruction for Gemini Omni 1.1 Flash.',
        `The user selected absolute timestamp ${window.timestampSec.toFixed(2)}s; it is ${relative.toFixed(2)}s inside this trimmed ${rounded(window.endSec - window.startSec).toFixed(2)}s clip.`,
        `User request: ${request}`,
        'Describe what is visibly on screen at that point, then state exactly what changes and when. Explicitly preserve every non-requested property: character identity and wardrobe, product identity, background, camera framing and motion, lighting, color, continuity, clip duration, and original audio. Do not add cuts or unrelated motion. Return only the detailed edit instruction, 120–220 words.',
      ].join('\n'),
    },
    ...frames.flatMap((frame) => [
      { type: 'text', text: `Sampled frame at ${frame.timestamp.toFixed(2)}s inside the trimmed clip:` },
      { type: 'image_url', image_url: { url: frame.url } },
    ]),
  ];
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: await tokenHeaders(),
    body: JSON.stringify({
      model: 'gpt-6.1-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: 6000,
      messages: [{ role: 'user', content }],
      stream: false,
    }),
  });
  const body = await responseJson(response, 'Vision analysis failed');
  const prompt = String(body?.choices?.[0]?.message?.content || '').trim();
  if (prompt.length < 80) throw new VergerMediaError('The vision agent returned an unusably short edit prompt.');
  return prompt;
}

export async function prepareVisualEdit(
  sourceUrl: string,
  sourceDuration: number,
  timestampSec: number,
  request: string,
  onProgress: (progress: EditProgress) => void,
): Promise<PreparedVisualEdit> {
  if (!/^https?:\/\//i.test(sourceUrl)) throw new VergerMediaError('Choose a finished hosted video before starting a visual edit.', 400);
  if (!request.trim()) throw new VergerMediaError('Describe the visual change you want.', 400);
  const window = editWindowAt(timestampSec, sourceDuration);
  onProgress({ phase: 'trimming', agent: 'Edit Coordinator', detail: `Trimming ${window.startSec.toFixed(2)}–${window.endSec.toFixed(2)}s (never more than 8s)` });
  const clipUrl = await trimVideo(sourceUrl, window.startSec, window.endSec);
  onProgress({ phase: 'analysing', agent: 'Vision Reviewer', detail: 'Sampling five frames around the selected moment' });
  const frames = await extractFrames(clipUrl, window.endSec - window.startSec);
  onProgress({ phase: 'prompting', agent: 'Prompt Director', detail: 'Writing a precise preserve/change/timing instruction' });
  const prompt = await writeDetailedEditPrompt(frames, request, window);
  onProgress({ phase: 'awaiting_approval', agent: 'Verger', detail: `Prompt ready · ${OMNI_EDIT_CREDITS} credits before Omni Flash` });
  return { sourceUrl, sourceDuration, clipUrl, window, frames, prompt, request };
}

async function submitOmniEdit(prepared: PreparedVisualEdit, prompt: string): Promise<string> {
  const duration = Math.max(1, Math.min(OMNI_MAX_CLIP_SECONDS, Math.ceil(prepared.window.endSec - prepared.window.startSec)));
  const response = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: await tokenHeaders(),
    body: JSON.stringify({
      model: 'gemini-omni-1.1-flash',
      prompt,
      duration,
      resolution: '720p',
      generateAudio: true,
      videoData: prepared.clipUrl,
      videoMimeType: 'video/mp4',
    }),
  });
  const body = await responseJson(response, 'Omni Flash rejected the edit');
  const operationId = String(body?.operationId || '');
  if (!operationId) throw new VergerMediaError('Omni Flash accepted the request but returned no operation id.');
  return operationId;
}

async function pollOmniEdit(operationId: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const response = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, { headers: await tokenHeaders(false), signal });
    const body = await responseJson(response, 'Could not read Omni Flash status');
    const status = String(body?.status || '').toLowerCase();
    if (status === 'completed' && body?.videoUrl) return String(body.videoUrl);
    if (status === 'failed') throw new VergerMediaError(String(body?.errorMessage || 'Omni Flash could not apply this edit.'));
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new VergerMediaError('Omni Flash is still processing after 10 minutes. The operation was saved; reopen this project to check it without spending again.', 504);
}

async function stitchUrls(videoUrls: string[]): Promise<string> {
  if (videoUrls.length === 1) return videoUrls[0];
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/videos/stitch`, {
    method: 'POST',
    headers: await tokenHeaders(),
    body: JSON.stringify({ videoUrls }),
  });
  const body = await responseJson(response, 'Video splice failed');
  const url = String(body?.stitchedUrl || body?.video?.videoUrl || '');
  if (!url) throw new VergerMediaError('Video splice returned no finished MP4.');
  return url;
}

async function finishPreparedVisualEdit(
  prepared: PreparedVisualEdit,
  operationId: string,
  onProgress: (progress: EditProgress) => void,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; editedClipUrl: string; operationId: string }> {
  const editedClipUrl = await pollOmniEdit(operationId, signal);
  onProgress({ phase: 'splicing', agent: 'Finishing Agent', detail: 'Splicing the edited window back into the original server-side' });
  const urls: string[] = [];
  if (prepared.window.startSec > 0.05) urls.push(await trimVideo(prepared.sourceUrl, 0, prepared.window.startSec));
  urls.push(editedClipUrl);
  if (prepared.sourceDuration - prepared.window.endSec > 0.05) {
    urls.push(await trimVideo(prepared.sourceUrl, prepared.window.endSec, prepared.sourceDuration));
  }
  const videoUrl = await stitchUrls(urls);
  onProgress({ phase: 'completed', agent: 'QA & Error Agent', detail: 'Edited MP4 is ready; the original remains available for instant revert' });
  return { videoUrl, editedClipUrl, operationId };
}

export async function resumePreparedVisualEdit(
  prepared: PreparedVisualEdit,
  operationId: string,
  onProgress: (progress: EditProgress) => void,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; editedClipUrl: string; operationId: string }> {
  onProgress({ phase: 'editing', agent: 'Omni Flash Editor', detail: 'Resuming the saved provider operation without a new paid submit' });
  return finishPreparedVisualEdit(prepared, operationId, onProgress, signal);
}

export async function applyPreparedVisualEdit(
  prepared: PreparedVisualEdit,
  approvedPrompt: string,
  onProgress: (progress: EditProgress) => void,
  onOperation: (operationId: string) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; editedClipUrl: string; operationId: string }> {
  onProgress({ phase: 'editing', agent: 'Omni Flash Editor', detail: `Applying the approved <=8s edit · ${OMNI_EDIT_CREDITS} credits` });
  // Never retry this submit automatically: a second submit could spend twice.
  const operationId = await submitOmniEdit(prepared, approvedPrompt);
  await onOperation(operationId);
  return finishPreparedVisualEdit(prepared, operationId, onProgress, signal);
}
