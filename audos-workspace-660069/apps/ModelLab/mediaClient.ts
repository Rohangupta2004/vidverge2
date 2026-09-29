/**
 * MODEL LAB — the generation client.
 *
 * One `generate()` entry point, four provider adapters behind it. Each adapter
 * knows exactly one contract:
 *
 *   group-a     POST /api/veo/generate/video          → GET /api/veo/status/:id
 *   kling       POST /api/generate/kling/{text|image}-to-video
 *                                                     → GET /api/generate/kling/status/:id
 *   runway      POST /api/generate/runway/video       → GET /api/generate/runway/status/:id
 *   higgsfield  POST /api/generate/higgsfield/{video|image-to-video|image|soul}
 *                                                     → GET /api/generate/higgsfield/status/:id
 *   images      the vv-image-generate server function, which owns the
 *               OpenAI / Gemini model ladder and re-hosts data: URLs on GCS
 *
 * Every wallet-spending call carries X-Workspace-DB-Token; anonymous requests
 * are refused before the provider is contacted. Provider error codes are
 * translated into one sentence a person can act on rather than a status code.
 */
import type { ImageModelCard, VideoModelCard } from './mediaModels';

export type GenerationKind = 'image' | 'video';

export interface GenerationResult {
  url: string;
  kind: GenerationKind;
  modelUsed: string;
  note: string;
  elapsedMs: number;
}

export interface GenerateArgs {
  card: ImageModelCard | VideoModelCard;
  prompt: string;
  options: Record<string, string>;
  /** Public https URL or base64 frame, for the image-to-video models. */
  imageUrl?: string;
  negativePrompt?: string;
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

export function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  const s = String(e ?? '');
  return s && s !== '[object Object]' ? s : 'Something went wrong.';
}

function idempotencyKey(): string {
  const c = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `ml-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = wsToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Workspace-DB-Token': token } : {}),
    ...(extra || {}),
  };
}

/** Turn a provider failure into one actionable sentence. */
function providerError(status: number, data: any, provider: string): Error {
  if (status === 401) return new Error(`${provider} refused the request because this page has no workspace credential. Reload and try again.`);
  if (status === 402) return new Error(`The workspace wallet is short of funds for this ${provider} generation. Top it up and retry.`);
  if (status === 403) return new Error(`This workspace is not allowed to bill ${provider}.`);
  if (status === 429) return new Error(`${provider} is rate-limiting this workspace. Wait a moment and try again.`);
  if (status === 503) return new Error(`${provider} is not configured on this platform yet, so it cannot be called.`);
  const detail = data?.error?.message || data?.error || data?.message || data?.errorMessage;
  if (Array.isArray(data?.details) && data.details.length) {
    const first = data.details[0];
    return new Error(`${provider} rejected the request: ${String(first?.message || first)}`);
  }
  return new Error(detail ? `${provider}: ${String(detail)}` : `${provider} answered HTTP ${status}.`);
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => null);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { window.clearTimeout(t); reject(new Error('Cancelled.')); }, { once: true });
  });

export async function callHook(name: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/hooks/execute/${appId()}/${name}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const raw = await readJson(res);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  if (data && data.success === false && data.error) throw new Error(String(data.error));
  return data || {};
}

// ---------------------------------------------------------------------------
// Live availability
// ---------------------------------------------------------------------------

export interface ProviderStatus {
  available: boolean;
  status: number;
  error?: string;
}

export interface Capabilities {
  groupA: ProviderStatus;
  kling: ProviderStatus;
  runway: ProviderStatus;
  higgsfield: ProviderStatus;
  checkedAt: string;
}

const OPTIMISTIC: ProviderStatus = { available: true, status: 0 };

export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    const data = await callHook('vv-media-capabilities', {});
    const read = (v: any): ProviderStatus => ({
      available: v?.available !== false,
      status: Number(v?.status) || 0,
      error: v?.error ? String(v.error) : undefined,
    });
    return {
      groupA: read(data.groupA),
      kling: read(data.kling),
      runway: read(data.runway),
      higgsfield: read(data.higgsfield),
      checkedAt: String(data.checkedAt || new Date().toISOString()),
    };
  } catch {
    // A failed probe must not hide every model — let the submit report the truth.
    return { groupA: OPTIMISTIC, kling: OPTIMISTIC, runway: OPTIMISTIC, higgsfield: OPTIMISTIC, checkedAt: '' };
  }
}

// ---------------------------------------------------------------------------
// Image adapters
// ---------------------------------------------------------------------------

async function generateManagedImage(args: GenerateArgs): Promise<GenerationResult> {
  const started = Date.now();
  args.onProgress?.('Generating…');
  const data = await callHook('vv-image-generate', {
    prompt: args.prompt,
    model: args.card.id,
    aspect: args.options.aspectRatio || '1:1',
    quality: args.options.quality || 'standard',
    negativePrompt: args.negativePrompt || '',
  });
  const url = String(data?.imageUrl || '');
  if (!url) throw new Error('The image service returned no image.');
  const fellBack = String(data?.fellBackFrom || '');
  return {
    url,
    kind: 'image',
    modelUsed: String(data?.modelUsed || args.card.id),
    note: fellBack ? `${fellBack} produced nothing, so this ran on ${data?.modelUsed} instead.` : '',
    elapsedMs: Date.now() - started,
  };
}

async function pollHiggsfield(requestId: string, signal?: AbortSignal, onProgress?: (n: string) => void): Promise<any> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (signal?.aborted) throw new Error('Cancelled.');
    const res = await fetch(`/api/generate/higgsfield/status/${encodeURIComponent(requestId)}`, { headers: authHeaders(), signal });
    const data = await readJson(res);
    if (!res.ok) throw providerError(res.status, data, 'Higgsfield');
    const status = String(data?.status || '');
    if (status === 'completed') return data;
    if (status === 'nsfw') throw new Error('Higgsfield moderation rejected that prompt. Reword it and try again.');
    if (status === 'failed') throw new Error(String(data?.errorMessage || 'Higgsfield reported the generation failed.'));
    onProgress?.(`Higgsfield is ${status || 'working'}… (${attempt * 5}s)`);
    await sleep(5000, signal);
  }
  throw new Error('Higgsfield is still working after 7 minutes. Check back shortly.');
}

async function generateHiggsfieldImage(args: GenerateArgs): Promise<GenerationResult> {
  const started = Date.now();
  const soul = args.card.id.startsWith('soul');
  const path = soul ? '/api/generate/higgsfield/soul' : '/api/generate/higgsfield/image';
  const body: Record<string, unknown> = { prompt: args.prompt };
  if (soul) {
    body.model = args.options.style || args.card.id;
    if (args.options.size) body.widthAndHeight = args.options.size.replace(':', 'x');
    if (args.options.quality) body.quality = args.options.quality;
  } else {
    body.model = 'popcorn';
    body.aspectRatio = args.options.aspectRatio || '16:9';
  }
  if (args.options.seed) body.seed = Number(args.options.seed);

  args.onProgress?.('Submitting to Higgsfield…');
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: args.signal });
  const data = await readJson(res);
  if (!res.ok || !data?.requestId) throw providerError(res.status, data, 'Higgsfield');

  const done = await pollHiggsfield(String(data.requestId), args.signal, args.onProgress);
  const url = String(done?.images?.[0]?.url || done?.videoUrl || '');
  if (!url) throw new Error('Higgsfield finished but returned no image.');
  return { url, kind: 'image', modelUsed: String(body.model), note: '', elapsedMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Video adapters
// ---------------------------------------------------------------------------

async function generateGroupAVideo(args: GenerateArgs): Promise<GenerationResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: args.card.id,
    prompt: args.prompt,
    aspectRatio: args.options.aspectRatio || '16:9',
  };
  if (args.options.duration) body.duration = Number(args.options.duration);
  if (args.options.resolution) body.resolution = args.options.resolution;
  if (args.options.generateAudio === 'true') body.generateAudio = true;
  if (args.negativePrompt) body.negativePrompt = args.negativePrompt;
  if (args.imageUrl) body.imageData = args.imageUrl;

  args.onProgress?.('Submitting to the video proxy…');
  const res = await fetch('/api/veo/generate/video', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: args.signal });
  const data = await readJson(res);
  if (!res.ok || !data?.operationId) throw providerError(res.status, data, args.card.name);
  const operationId = String(data.operationId);
  // The proxy has been seen answering 200 with a synthetic already-failed id.
  if (/_error_/.test(operationId)) {
    throw new Error(`${args.card.name} rejected the job upstream (${operationId}). Try another engine — Veo 3.1 Fast is the reliable fallback.`);
  }

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (args.signal?.aborted) throw new Error('Cancelled.');
    const poll = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, { headers: authHeaders(), signal: args.signal });
    const state = await readJson(poll);
    if (!poll.ok) throw providerError(poll.status, state, args.card.name);
    const status = String(state?.status || '');
    if (status === 'completed' && state?.videoUrl) {
      return { url: String(state.videoUrl), kind: 'video', modelUsed: args.card.id, note: '', elapsedMs: Date.now() - started };
    }
    if (status === 'failed') throw new Error(String(state?.errorMessage || `${args.card.name} reported the render failed.`));
    args.onProgress?.(`${args.card.name} is rendering… ${Number(state?.progress) || Math.min(95, attempt * 3)}%`);
    await sleep(5000, args.signal);
  }
  throw new Error(`${args.card.name} is still rendering after 7 minutes. Check back shortly.`);
}

async function generateKlingVideo(args: GenerateArgs): Promise<GenerationResult> {
  const started = Date.now();
  const imageToVideo = Boolean(args.imageUrl);
  const path = imageToVideo ? '/api/generate/kling/image-to-video' : '/api/generate/kling/text-to-video';
  const body: Record<string, unknown> = {
    model: args.card.id,
    prompt: args.prompt,
    duration: args.options.duration || '5',
    // v2-master is std-only; the card hides the control and this keeps the
    // request honest even if an old option value is still in state.
    mode: args.card.id === 'kling-v2-master' ? 'std' : args.options.mode || 'std',
  };
  if (!imageToVideo) body.aspectRatio = args.options.aspectRatio || '16:9';
  if (imageToVideo) body.imageData = args.imageUrl;
  if (args.negativePrompt) body.negativePrompt = args.negativePrompt;
  if (args.options.seed) body.seed = Number(args.options.seed);

  args.onProgress?.('Submitting to Kling…');
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: args.signal });
  const data = await readJson(res);
  if (!res.ok || !data?.taskId) throw providerError(res.status, data, 'Kling');
  const taskId = String(data.taskId);

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (args.signal?.aborted) throw new Error('Cancelled.');
    const poll = await fetch(`/api/generate/kling/status/${encodeURIComponent(taskId)}`, { headers: authHeaders(), signal: args.signal });
    const state = await readJson(poll);
    if (!poll.ok) throw providerError(poll.status, state, 'Kling');
    const status = String(state?.status || '');
    if (status === 'completed' && state?.videoUrl) {
      return { url: String(state.videoUrl), kind: 'video', modelUsed: args.card.id, note: String(data?.modelFallback || ''), elapsedMs: Date.now() - started };
    }
    if (status === 'failed') throw new Error(String(state?.errorMessage || 'Kling reported the generation failed.'));
    args.onProgress?.(`Kling is ${status || 'working'}… (${attempt * 5}s)`);
    await sleep(5000, args.signal);
  }
  throw new Error('Kling is still working after 7 minutes. Check back shortly.');
}

async function generateRunwayVideo(args: GenerateArgs): Promise<GenerationResult> {
  const started = Date.now();
  const turbo = args.card.id === 'gen4_turbo';
  if (turbo && !args.imageUrl) {
    throw new Error('Runway Gen-4 Turbo is image-to-video only — add a public https image URL first.');
  }
  const body: Record<string, unknown> = {
    model: args.card.id,
    ratio: args.options.aspectRatio || '1280:720',
    duration: Number(args.options.duration) || 5,
  };
  if (args.imageUrl) {
    body.promptImage = args.imageUrl;
    if (!turbo) { body.mode = 'image-to-video'; body.promptText = args.prompt; }
  } else {
    body.promptText = args.prompt;
  }

  args.onProgress?.('Submitting to Runway…');
  const res = await fetch('/api/generate/runway/video', {
    method: 'POST',
    headers: authHeaders({ 'Idempotency-Key': idempotencyKey() }),
    body: JSON.stringify(body),
    signal: args.signal,
  });
  const data = await readJson(res);
  if (!res.ok && res.status !== 202) throw providerError(res.status, data, 'Runway');
  const taskId = String(data?.taskId || data?.id || '');
  if (!taskId) throw new Error('Runway accepted the request but returned no task id.');

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (args.signal?.aborted) throw new Error('Cancelled.');
    const poll = await fetch(`/api/generate/runway/status/${encodeURIComponent(taskId)}`, { headers: authHeaders(), signal: args.signal });
    const state = await readJson(poll);
    if (!poll.ok) throw providerError(poll.status, state, 'Runway');
    const status = String(state?.status || '');
    if (status === 'succeeded') {
      const url = String(state?.outputs?.[0]?.url || state?.output?.[0] || state?.videoUrl || '');
      if (!url) throw new Error('Runway succeeded but returned no media URL.');
      return { url, kind: 'video', modelUsed: args.card.id, note: '', elapsedMs: Date.now() - started };
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Runway ended ${status}: ${String(state?.error?.message || state?.error || 'no successful output')}`);
    }
    if (status === 'uncertain') {
      throw new Error('Runway cannot confirm that job either way. Do not resubmit — check your Runway usage before trying again.');
    }
    args.onProgress?.(`Runway is ${status || 'working'}… (${attempt * 5}s)`);
    await sleep(5000, args.signal);
  }
  throw new Error('Runway is still working after 7 minutes. Check back shortly.');
}

async function generateHiggsfieldVideo(args: GenerateArgs): Promise<GenerationResult> {
  const started = Date.now();
  const dop = args.card.id.startsWith('dop');
  if (dop && !args.imageUrl) {
    throw new Error('Higgsfield DoP is image-to-video only — add a public https image URL or a base64 frame first.');
  }
  const path = dop ? '/api/generate/higgsfield/image-to-video' : '/api/generate/higgsfield/video';
  const body: Record<string, unknown> = { prompt: args.prompt };
  if (dop) {
    body.model = args.options.style || 'dop-turbo';
    body.imageData = args.imageUrl;
  } else {
    body.model = 'minimax-hailuo-02';
    body.aspectRatio = args.options.aspectRatio || '16:9';
    if (args.options.duration) body.durationSeconds = Number(args.options.duration);
  }
  if (args.options.seed) body.seed = Number(args.options.seed);

  args.onProgress?.('Submitting to Higgsfield…');
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: args.signal });
  const data = await readJson(res);
  if (!res.ok || !data?.requestId) throw providerError(res.status, data, 'Higgsfield');

  const done = await pollHiggsfield(String(data.requestId), args.signal, args.onProgress);
  const url = String(done?.videoUrl || '');
  if (!url) throw new Error('Higgsfield finished but returned no video.');
  return { url, kind: 'video', modelUsed: String(body.model), note: '', elapsedMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function generate(args: GenerateArgs): Promise<GenerationResult> {
  const prompt = args.prompt.trim();
  if (prompt.length < 10) throw new Error('Write at least ten characters of prompt — every provider rejects anything shorter.');
  const card = args.card;
  const isVideo = 'durations' in card;

  if (!isVideo) {
    if (card.family === 'higgsfield') return generateHiggsfieldImage({ ...args, prompt });
    return generateManagedImage({ ...args, prompt });
  }
  if (card.family === 'kling') return generateKlingVideo({ ...args, prompt });
  if (card.family === 'runway') return generateRunwayVideo({ ...args, prompt });
  if (card.family === 'higgsfield') return generateHiggsfieldVideo({ ...args, prompt });
  return generateGroupAVideo({ ...args, prompt });
}

// ---------------------------------------------------------------------------
// ✦ AI Write — the prompt writer
// ---------------------------------------------------------------------------

export const PROMPT_WRITER_MODEL = 'claude-sonnet-5';
const PROMPT_WRITER_FALLBACK = 'gpt-5.6-terra';

function writerSystem(card: ImageModelCard | VideoModelCard): string {
  const isVideo = 'durations' in card;
  const strengths = [
    `Model: ${card.name} by ${card.provider}.`,
    `What it is good at: ${card.bestFor}`,
    `How it behaves: ${card.blurb}`,
    isVideo
      ? `Supported: ${(card as VideoModelCard).features.join(', ')}. Clip length ${(card as VideoModelCard).durations}.`
      : `Supported sizes: ${(card as ImageModelCard).sizes.join(', ')}.`,
    card.caveat ? `Known limitation: ${card.caveat}` : '',
  ].filter(Boolean).join('\n');

  return [
    `You are a prompt engineer who writes for one specific generative model.`,
    '',
    strengths,
    '',
    isVideo
      ? 'Turn the user\'s plain-English idea into ONE generation prompt for that model. Name the subject, the action, the camera move, the lens and framing, the lighting, the palette and the overall mood. Keep it to a single flowing paragraph under 850 characters. Never ask for on-screen text, captions, logos or watermarks — generative video cannot spell.'
      : 'Turn the user\'s plain-English idea into ONE image prompt for that model. Name the subject, the composition and camera angle, the lighting, the palette, the material and texture detail, and the overall style. Keep it to a single flowing paragraph under 700 characters. Never ask for words, lettering or logos in the image.',
    '',
    'Return ONLY the prompt itself. No preamble, no quotes, no markdown, no explanation, no options list.',
  ].join('\n');
}

export async function writePrompt(
  card: ImageModelCard | VideoModelCard,
  idea: string,
  signal?: AbortSignal,
): Promise<{ prompt: string; model: string }> {
  const token = wsToken();
  if (!token) throw new Error('This page has no workspace credential, so the AI proxy will refuse the call. Reload and try again.');
  const system = writerSystem(card);
  const user = `Write the prompt for this idea:\n\n${idea.trim()}`;

  const clean = (text: string) => text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').replace(/^["']|["']$/g, '').trim();

  try {
    const res = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ model: PROMPT_WRITER_MODEL, max_tokens: 700, system, messages: [{ role: 'user', content: user }] }),
      signal,
    });
    const data = await readJson(res);
    if (!res.ok) throw providerError(res.status, data, 'Claude');
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text || '')).join('')
      : '';
    if (!text.trim()) throw new Error('Claude returned an empty prompt.');
    return { prompt: clean(text), model: PROMPT_WRITER_MODEL };
  } catch (primaryError) {
    if (signal?.aborted) throw primaryError;
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: PROMPT_WRITER_FALLBACK,
        reasoning_effort: 'none',
        max_completion_tokens: 700,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal,
    });
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(`Both prompt writers refused. ${PROMPT_WRITER_MODEL}: ${errorText(primaryError)} — ${PROMPT_WRITER_FALLBACK}: ${errorText(providerError(res.status, data, 'GPT'))}`);
    }
    const text = String(data?.choices?.[0]?.message?.content || '');
    if (!text.trim()) throw new Error('The prompt writer returned nothing.');
    return { prompt: clean(text), model: PROMPT_WRITER_FALLBACK };
  }
}
