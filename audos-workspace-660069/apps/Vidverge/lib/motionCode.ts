/**
 * CODE-ENGINEERED MOTION — Pipeline A's generation step.
 *
 * Claude Opus 5 is asked for a complete Remotion composition as TSX. Nothing
 * it writes is trusted on sight: the reply is unwrapped from its fences,
 * audited against what the render farm can actually compile, and retried once
 * with the audit findings fed back. A second failure falls through to the
 * deterministic composition in ./kineticFallback rather than sending the farm
 * source that will not build.
 *
 * MODEL CONTRACT (anthropic-text-generation): Opus 5 cannot disable thinking,
 * so `thinking: { type: 'adaptive' }` is paired with
 * `output_config: { effort: 'medium' }` as the integration documents. Claude 5
 * models reject `temperature` / `top_p` / `top_k` with a 400, so none are
 * sent, and `max_tokens` is mandatory and capped at 8,192.
 */

import type { AudioToken, BrandKit } from '../types';
import { authHeaders, describePlatformError, EngineStageError, GENERATION_TIMEOUT_MS, isAbortError, timeoutSignal } from './runtime';
import { KINETIC_FALLBACK_SOURCE } from './kineticFallback';
import { clampFrames, FPS, FRAME_H, FRAME_W, PORTRAIT_H, PORTRAIT_W } from './render';

export const MOTION_MODEL = 'claude-opus-5';

/** The proxy's ceiling. A composition rarely needs it all, but a truncated
 * reply is the single most common reason the audit fails. */
const MAX_TOKENS = 8192;

/** The markdown fence the reply is wrapped in, assembled rather than written
 * literally so this source stays safe to transport as JSON. */
const FENCE = String.fromCharCode(96, 96, 96);

/**
 * The brief for the motion engineer.
 *
 * The geometry is the one place this departs from the creative brief, and it
 * has to: the platform's render service is FIXED at 1920x1080 / 30fps and
 * rejects any other `fps` / `width` / `height`. The reel is still composed as
 * a 1080x1920 portrait stage — it is simply scaled into the frame the farm
 * will render, which is the approach the other VidVerge studios use. A prompt
 * asking for 60fps portrait output would only produce a composition the
 * service refuses.
 */
export const KINETIC_SYSTEM_PROMPT = [
  'Role: Senior Motion Design Engineer.',
  'Task: Output a single, valid TypeScript (.tsx) Remotion composition.',
  'Constraints:',
  '- Compose a ' + PORTRAIT_W + 'x' + PORTRAIT_H + ' portrait stage and scale it to fit inside the ' + FRAME_W + 'x' + FRAME_H + ' render frame. Read props.frame_width and props.frame_height; never hardcode the outer frame.',
  '- The render runs at ' + FPS + 'fps. Read fps from useVideoConfig() and never hardcode a different rate.',
  '- Follow the 3-Object Rule: 1 Centered Hero at 70% scale, 2 Flanking Badges, 1 subtle particle/grid layer. Nothing else on screen.',
  '- Use spring physics for every entrance: spring({ frame, fps, config: { damping: 12, mass: 0.5 } }).',
  '- Lexical Subtitles: props.words is [{ word, start_ms, end_ms }]. Show the words around the current time and animate the word being spoken with transform: scale(1.1) and the accent colour. Derive the current time from useCurrentFrame() and fps.',
  '- Use props.brand.colors for every colour. No generic AI gradients, no purple-to-pink washes, no stock aurora backgrounds.',
  '- Mount props.voiceover_url with Remotion\u2019s <Audio> so the narration plays.',
  '- Import ONLY from "react" and "remotion". No other package, no workspace path, no fetch, no network access of any kind.',
  '- The component must be the default export and take a single props object.',
  '- Return ONLY the composition inside a tsx code fence. No commentary before or after.',
].join('\n');

export interface KineticProps {
  brand: {
    name: string;
    colors: string[];
    logoUrl: string | null;
    headline: string;
    subheadline: string;
  };
  badges: string[];
  words: AudioToken[];
  voiceover_url: string;
  frame_width: number;
  frame_height: number;
  stage_width: number;
  stage_height: number;
  total_frames: number;
}

export function buildKineticProps(input: {
  brand: BrandKit;
  badges: string[];
  tokens: AudioToken[];
  voiceoverUrl: string;
  totalFrames: number;
}): KineticProps {
  return {
    brand: {
      name: input.brand.siteName,
      colors: input.brand.colors,
      logoUrl: input.brand.logoUrl,
      headline: input.brand.headline || input.brand.siteName,
      subheadline: input.brand.subheadline,
    },
    badges: input.badges,
    words: input.tokens,
    voiceover_url: input.voiceoverUrl,
    frame_width: FRAME_W,
    frame_height: FRAME_H,
    stage_width: PORTRAIT_W,
    stage_height: PORTRAIT_H,
    total_frames: clampFrames(input.totalFrames),
  };
}

/** The brief Claude writes against, as the user turn. */
function userBrief(props: KineticProps, creativeDirection: string): string {
  return [
    'Build the composition for this product reel.',
    '',
    'Product: ' + props.brand.name,
    'Headline on screen: ' + props.brand.headline,
    props.brand.subheadline ? 'Supporting line: ' + props.brand.subheadline : '',
    'Brand colours, most used first: ' + props.brand.colors.join(', '),
    props.brand.logoUrl
      ? 'Logo image URL (render it with <Img>): ' + props.brand.logoUrl
      : 'No logo image is available — set the brand in type instead.',
    'Flanking badge copy: ' + props.badges.join(' | '),
    'Total length: ' + props.total_frames + ' frames at ' + FPS + 'fps.',
    'Words available for the lexical subtitles: ' + props.words.length + '.',
    '',
    'What the customer asked for:',
    creativeDirection,
    '',
    'Props the component receives:',
    JSON.stringify(
      {
        brand: { name: 'string', colors: ['#hex'], logoUrl: 'string | null', headline: 'string', subheadline: 'string' },
        badges: ['string', 'string'],
        words: [{ word: 'string', start_ms: 0, end_ms: 0 }],
        voiceover_url: 'string',
        frame_width: FRAME_W,
        frame_height: FRAME_H,
        stage_width: PORTRAIT_W,
        stage_height: PORTRAIT_H,
        total_frames: props.total_frames,
      },
      null,
      2,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pull the composition out of the reply's fenced block. */
export function extractTsx(reply: string): string {
  const pattern = new RegExp(FENCE + '(?:tsx|typescript|ts)?\\s*\\n([\\s\\S]*?)' + FENCE);
  const fenced = String(reply || '').match(pattern);
  const body = fenced ? fenced[1] : String(reply || '');
  return body.trim();
}

export interface AuditResult {
  ok: boolean;
  problems: string[];
}

/**
 * What the render farm will and will not accept. These are the failures that
 * cost a whole render to discover, so they are caught before submitting: a
 * truncated reply, an unresolvable import, or no component to mount.
 */
export function auditComposition(tsx: string): AuditResult {
  const problems: string[] = [];
  const source = String(tsx || '');

  if (source.length < 400) problems.push('The composition is too short to be a real scene.');
  if (!/export\s+default/.test(source)) problems.push('There is no default export for the renderer to mount.');
  if (!/from\s+['"]remotion['"]/.test(source)) problems.push('Nothing is imported from remotion.');
  if (!/useCurrentFrame\s*\(/.test(source)) problems.push('Nothing reads useCurrentFrame, so nothing animates.');

  const imports = source.match(/from\s+['"]([^'"]+)['"]/g) || [];
  for (const entry of imports) {
    const name = entry.replace(/^from\s+['"]/, '').replace(/['"]$/, '');
    if (name !== 'react' && name !== 'remotion') {
      problems.push('"' + name + '" cannot be imported — the render farm resolves only react and remotion.');
    }
  }
  if (/\brequire\s*\(/.test(source)) problems.push('require() is not available in the render runtime.');
  if (/\bfetch\s*\(/.test(source)) problems.push('The composition cannot make network calls while rendering.');

  const opens = (source.match(/{/g) || []).length;
  const closes = (source.match(/}/g) || []).length;
  if (opens !== closes) problems.push('The braces do not balance — the reply looks truncated.');

  return { ok: problems.length === 0, problems };
}

async function askClaude(system: string, user: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: MOTION_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: user }],
      }),
      signal: timeoutSignal(GENERATION_TIMEOUT_MS),
    });
  } catch (error: any) {
    // A hung proxy call must not hang the whole stage — the caller falls
    // back to the deterministic composition on any throw from here.
    throw new EngineStageError(
      isAbortError(error)
        ? 'The motion engineer did not answer within 2 minutes.'
        : `The motion engineer could not be reached: ${String(error?.message || error)}`,
      'motion_code',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EngineStageError(
      describePlatformError(data, response.status, 'The motion engineer could not be reached'),
      'motion_code',
    );
  }
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => String(block.text || ''))
        .join('')
    : '';
  if (!text.trim()) {
    throw new EngineStageError('The motion engineer returned an empty composition.', 'motion_code');
  }
  return text;
}

/** Bake the length in, so the render knows it even without the submit field. */
function withDuration(source: string, totalFrames: number): string {
  if (/calculateDemoVideoDuration/.test(source)) return source;
  return [
    source,
    '',
    'export const calculateDemoVideoDuration = function () { return ' + clampFrames(totalFrames) + '; };',
    '',
  ].join('\n');
}

export interface GeneratedComposition {
  source: string;
  /** True when the deterministic composition is being rendered instead. */
  usedFallback: boolean;
  /** What the audit objected to, when it objected. */
  auditNotes: string[];
}

/** The composition for one reel. Always returns something renderable. */
export async function generateKineticComposition(
  props: KineticProps,
  creativeDirection: string,
  onDetail?: (detail: string) => void,
): Promise<GeneratedComposition> {
  const brief = userBrief(props, creativeDirection);
  const notes: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    onDetail?.(attempt === 1 ? 'Engineering the motion…' : 'Correcting the composition…');
    const user =
      attempt === 1
        ? brief
        : [
            brief,
            '',
            'Your previous composition was rejected before rendering. Fix exactly these and return the whole file again:',
            ...notes.map((note) => '- ' + note),
          ].join('\n');

    let reply: string;
    try {
      reply = await askClaude(KINETIC_SYSTEM_PROMPT, user);
    } catch (error) {
      // A proxy failure is not a composition problem, and asking again the
      // same way will not fix it. Fall straight to the deterministic reel.
      notes.push(String((error as Error)?.message || error));
      break;
    }

    const source = extractTsx(reply);
    const audit = auditComposition(source);
    if (audit.ok) {
      return { source: withDuration(source, props.total_frames), usedFallback: false, auditNotes: notes };
    }
    notes.length = 0;
    notes.push(...audit.problems);
  }

  onDetail?.('Falling back to the built-in kinetic composition…');
  return {
    source: withDuration(KINETIC_FALLBACK_SOURCE, props.total_frames),
    usedFallback: true,
    auditNotes: notes,
  };
}
