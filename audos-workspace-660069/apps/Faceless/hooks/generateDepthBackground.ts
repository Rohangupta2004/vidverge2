/**
 * generateDepthBackground — Layer 1 of the documentary depth stage.
 *
 * Two steps, in this order, because the second one needs the first:
 *   1. A still. The scene is distilled into one short visual phrase and
 *      rendered as a cinematic plate.
 *   2. Motion. That exact still is handed to SEEDANCE 2.0 for img-to-vid.
 *
 * SEEDANCE IS THE ONLY MOTION MODEL ON THIS PATH. There is deliberately no
 * fallback to Omni, Kling or Veo: if Seedance cannot animate the plate, the
 * plate itself becomes the background and the layer renders still. A silent
 * substitution to another model would change the look of the layer without
 * anyone asking for it.
 *
 * TIMING. The caller gets an answer within PREVIEW_WAIT_MS so the stage can
 * paint immediately; a job still running at that point is reported as
 * degraded (still image, motion pending) and keeps polling in the background,
 * calling `onMotionReady` if it lands. Seedance usually needs longer than the
 * preview budget, so this is the normal path rather than the sad one — the
 * stage simply starts still and gains motion.
 */

import type { AspectId, DepthBackground } from '../types/editorial';
import { callFastText, callHook, sleep } from '../lib/platform';
import { aspectOf } from '../lib/facelessOptions';
import { generateImage } from './generateImage';

const STAGE = 'assets' as const;

/** The one video model this layer is allowed to use. */
export const SEEDANCE_MODEL = 'openrouter/bytedance/seedance-2.0-fast';

/** The provider caps a prompt at 1000 characters; stay clear of the edge. */
export const MAX_MOTION_PROMPT_CHARS = 950;

/** How long the caller waits before the layer paints as a still. */
export const PREVIEW_WAIT_MS = 30000;

/** How long the background poll keeps hoping after that. */
export const MOTION_WAIT_MS = 5 * 60 * 1000;

const POLL_MS = 3000;
const CLIP_SECONDS = 6;

export interface DepthBackgroundOptions {
  topic: string;
  script?: string;
  aspect: AspectId;
  /**
   * Whether to spend on Seedance motion at all. False returns the still plate
   * and nothing is submitted — one clip costs about $6, so this is opt-in.
   */
  motion?: boolean;
  onNote?: (note: string) => void;
  /** Fired if motion arrives after the preview budget expired. */
  onMotionReady?: (videoUrl: string) => void;
  /** Set when the app leaves the run; stops the background poll. */
  signal?: AbortSignal;
}

/**
 * One short visual phrase — a place and a light, not a thesis. The fast model
 * does the distilling; a failure falls back to the topic itself, which is
 * usually already a phrase of about the right shape.
 */
export async function distilSceneTopic(topic: string, script?: string): Promise<string> {
  const fallback = String(topic || '').trim().slice(0, 90) || 'an empty landscape at first light';
  const source = String(script || '').trim().slice(0, 1200);
  if (!source) return fallback;

  try {
    const raw = await callFastText({
      maxTokens: 60,
      system:
        'You turn a narration into ONE short visual phrase naming a place, a subject and a quality of light. No sentences, no narration, no camera directions, at most twelve words.',
      user: `Topic: ${fallback}\n\nNarration opening:\n${source}\n\nThe single establishing image for this film is:`,
    });
    const phrase = String(raw || '')
      .replace(/^["'\u201c\s]+|["'\u201d\s.]+$/g, '')
      .split('\n')[0]
      .trim();
    return phrase.length >= 6 ? phrase.slice(0, 120) : fallback;
  } catch {
    return fallback;
  }
}

export function buildBackgroundImagePrompt(sceneTopic: string, aspect: AspectId): string {
  const shape = aspect === 'portrait' ? 'Cinematic vertical shot' : 'Cinematic wide shot';
  return `${shape}, ${sceneTopic}, photorealistic, dramatic lighting, no text, no people`.slice(
    0,
    MAX_MOTION_PROMPT_CHARS,
  );
}

export function buildMotionPrompt(sceneTopic: string): string {
  return [
    `Slow cinematic push into ${sceneTopic}.`,
    'Only the camera moves: a gentle drift with subtle atmospheric parallax, dust and light shifting across the frame.',
    'Hold the composition. No cuts, no people entering, no text or lettering of any kind.',
  ]
    .join(' ')
    .slice(0, MAX_MOTION_PROMPT_CHARS);
}

interface MotionStatus {
  status?: string;
  videoUrl?: string | null;
  progress?: number;
  errorMessage?: string | null;
}

async function pollMotion(
  operationId: string,
  deadline: number,
  signal: AbortSignal | undefined,
  onNote?: (note: string) => void,
): Promise<{ videoUrl: string | null; reason?: string }> {
  let misses = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { videoUrl: null, reason: 'cancelled' };
    await sleep(POLL_MS);
    if (signal?.aborted) return { videoUrl: null, reason: 'cancelled' };

    let status: MotionStatus;
    try {
      status = await callHook<MotionStatus>('faceless-assets', { op: 'video_status', operationId }, STAGE);
    } catch {
      misses += 1;
      if (misses >= 5) return { videoUrl: null, reason: 'The motion status endpoint stopped answering.' };
      continue;
    }
    misses = 0;

    const state = String(status.status || '');
    if (state === 'completed' && status.videoUrl) return { videoUrl: String(status.videoUrl) };
    if (state === 'failed') {
      return { videoUrl: null, reason: status.errorMessage || 'Seedance reported a failed job.' };
    }
    if (typeof status.progress === 'number' && status.progress > 0) {
      onNote?.(`Background motion \u2014 ${Math.round(status.progress)}%`);
    }
  }
  return { videoUrl: null, reason: 'timeout' };
}

/**
 * Returns null only when the still itself could not be made, which is the one
 * case where there is no layer to show. Everything else is a success, degraded
 * or otherwise.
 */
export async function generateDepthBackground(
  options: DepthBackgroundOptions,
): Promise<DepthBackground | null> {
  const shape = aspectOf(options.aspect);

  options.onNote?.('Composing the background plate\u2026');
  const sceneTopic = await distilSceneTopic(options.topic, options.script);
  const imagePrompt = buildBackgroundImagePrompt(sceneTopic, options.aspect);
  const motionPrompt = buildMotionPrompt(sceneTopic);

  let stillUrl: string;
  try {
    stillUrl = await generateImage(imagePrompt, { aspectRatio: shape.providerRatio });
  } catch (error: any) {
    options.onNote?.(`The background plate could not be generated: ${short(error)}`);
    return null;
  }
  if (options.signal?.aborted) {
    return { stillUrl, videoUrl: null, prompt: imagePrompt, motionPrompt, degraded: true, reason: 'cancelled' };
  }

  const still: DepthBackground = {
    stillUrl,
    videoUrl: null,
    prompt: imagePrompt,
    motionPrompt,
    degraded: true,
  };

  if (options.motion !== true) {
    return { ...still, reason: 'motion_off' };
  }

  options.onNote?.('Seedance 2.0 is animating the background plate\u2026');
  let operationId = '';
  try {
    const submitted = await callHook<{ operationId?: string }>(
      'faceless-assets',
      {
        op: 'video_submit',
        model: SEEDANCE_MODEL,
        prompt: motionPrompt,
        imageUrl: stillUrl,
        aspectRatio: shape.providerRatio,
        duration: CLIP_SECONDS,
      },
      STAGE,
    );
    operationId = String(submitted.operationId || '');
  } catch (error: any) {
    return { ...still, reason: short(error) };
  }
  if (!operationId) {
    return { ...still, reason: 'Seedance accepted the plate but returned no operation id.' };
  }

  const previewDeadline = Date.now() + PREVIEW_WAIT_MS;
  const first = await pollMotion(operationId, previewDeadline, options.signal, options.onNote);
  if (first.videoUrl) {
    return { ...still, videoUrl: first.videoUrl, degraded: false };
  }
  if (first.reason !== 'timeout') {
    return { ...still, reason: first.reason };
  }

  // Out of preview budget but the job is alive. The stage paints still now and
  // swaps to the clip if it lands; nothing downstream waits on it.
  void pollMotion(operationId, Date.now() + MOTION_WAIT_MS - PREVIEW_WAIT_MS, options.signal, options.onNote)
    .then((late) => {
      if (late.videoUrl && !options.signal?.aborted) options.onMotionReady?.(late.videoUrl);
    })
    .catch(() => undefined);

  return { ...still, reason: 'timeout' };
}

function short(error: unknown): string {
  return String((error as any)?.message || error || 'unknown error').slice(0, 160);
}
