/**
 * SaaS Video — the agentic engine behind the Script-to-Video app.
 *
 * Four small sequential Claude Opus 5 calls instead of one enormous
 * generation. That is the whole trick: every response is small enough to
 * finish, so nothing ever comes back truncated.
 *
 *   1 PLAN      JSON scene manifest only — no code
 *   2 COMPOSE   one single-file Remotion composition
 *   3 VALIDATE  JSON verdict; a failure re-runs COMPOSE with the fix appended
 *   4 RENDER    Omni Flash background plate → the platform render service
 *
 * Every proxy call carries X-Workspace-DB-Token: both AI proxies reject an
 * anonymous request with 401 before the provider is ever contacted.
 */

import { ensureScriptToVideoSeed, seedPromptSuffix } from '../../lib/vidvergeSeed';

export const FPS = 30;

/** Frames a scene gets when the user leaves narration off (3s at 30fps). */
export const DEFAULT_SCENE_FRAMES = 90;

/**
 * The output budget every Opus call is held to.
 *
 * The API's own `max_tokens` is deliberately set higher than this. Opus 5
 * cannot disable thinking and its thinking tokens share that ceiling, so a
 * literal 1,500 would starve the answer and hand back exactly the truncated
 * file this design exists to avoid. The budget is enforced here instead —
 * measured on what actually came back, and a composition over it is sent
 * straight back to be shortened.
 */
export const TOKEN_BUDGET = 1500;

/** How many times COMPOSE may be re-run with a validator fix before we stop. */
export const MAX_COMPOSE_RETRIES = 2;

// ---------------------------------------------------------------------------
// Design tokens — dark terminal, amber energy
// ---------------------------------------------------------------------------

export const T = {
  bg: '#0a0a0f',
  bgLift: '#0e0e14',
  card: 'rgba(255,255,255,0.035)',
  cardStrong: 'rgba(255,255,255,0.055)',
  border: 'rgba(255,255,255,0.09)',
  borderLit: 'rgba(245,158,11,0.42)',
  text: '#f4f4f5',
  muted: 'rgba(244,244,245,0.56)',
  dim: 'rgba(244,244,245,0.32)',
  amber: '#f59e0b',
  amberSoft: 'rgba(245,158,11,0.12)',
  fail: '#ef4444',
  failSoft: 'rgba(239,68,68,0.12)',
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
} as const;

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

export interface StyleOption {
  id: string;
  label: string;
  blurb: string;
  direction: string;
  palette: string[];
}

export const STYLES: StyleOption[] = [
  {
    id: 'dark-glassmorphic',
    label: 'Dark Glassmorphic',
    blurb: 'Amber on black · frosted cards',
    direction:
      'Dark glassmorphic: near-black background, frosted translucent cards with backdrop-filter blur, hairline white borders, amber (#f59e0b) accents and highlighted headline words, generous negative space.',
    palette: ['#0a0a0f', '#f59e0b', '#fbbf24', '#f4f4f5'],
  },
  {
    id: 'clean-saas',
    label: 'Clean SaaS',
    blurb: 'Bright, product-led, crisp',
    direction:
      'Clean SaaS: bright off-white surfaces, crisp dark type, one confident accent colour, soft neutral shadows, product-screenshot energy, nothing decorative.',
    palette: ['#f8fafc', '#0f172a', '#2563eb', '#64748b'],
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    blurb: 'Filmic grade · slow push-ins',
    direction:
      'Cinematic: deep filmic grade, heavy contrast, wide letterboxed framing, slow push-ins and drifts, warm highlights against cool shadows, sparse title cards.',
    palette: ['#050505', '#e8d5a3', '#8c6f3f', '#dcdce0'],
  },
];

export function styleById(id: string): StyleOption {
  return STYLES.find((s) => s.id === id) || STYLES[0];
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface ManifestScene {
  duration: number;
  description: string;
  mood: string;
}

export interface Manifest {
  scenes: ManifestScene[];
  style: string;
  palette: string[];
  hasNarration: boolean;
}

export interface Verdict {
  valid: boolean;
  issue?: string;
  fix?: string;
}

/** The props every generated composition is rendered with. */
export interface CompositionProps {
  backgroundVideoUrl: string;
  narrationUrl: string;
  palette: string[];
  scenes: ManifestScene[];
}

export interface ProjectRow {
  id: number;
  title: string | null;
  prompt: string;
  style: string;
  manifest_json: Manifest | null;
  composition_code: string | null;
  background_video_url: string | null;
  narration_url: string | null;
  duration_frames: number | null;
  render_url: string | null;
  has_narration: boolean;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Session / auth plumbing
// ---------------------------------------------------------------------------

function runtime(): any {
  return typeof window === 'undefined' ? null : (window as any);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function appId(): string {
  return String(runtime()?.__APP_ID__ || runtime()?.__SPACE_ID__ || 'workspace-660069');
}

export function workspaceId(): string {
  return String(
    runtime()?.__workspaceDb?.workspaceId ||
    runtime()?.__WORKSPACE_ID__ ||
    'f24710e5-7c6d-4db4-92b4-c2c235877575',
  );
}

/** Both AI proxies and the render service refuse anonymous calls, so every
 * request waits for the injected workspace token rather than firing without it. */
export async function waitForToken(timeoutMs = 12000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let token = runtime()?.__workspaceDb?.token;
  while (!token && Date.now() < deadline) {
    await sleep(200);
    token = runtime()?.__workspaceDb?.token;
  }
  if (!token) throw new Error('Your workspace session is still loading — wait a moment and try again.');
  return String(token);
}

function apiError(body: any, fallback: string): string {
  const value = body?.error?.message || body?.error || body?.message || body?.errorMessage;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// ---------------------------------------------------------------------------
// Claude Opus 5 (platform Anthropic proxy)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface OpusResult {
  text: string;
  tokens: number;
}

async function opus(system: string, user: string, maxTokens: number): Promise<OpusResult> {
  const token = await waitForToken();
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: maxTokens,
      // Opus 5 cannot turn thinking off; adaptive + medium effort is the
      // documented pairing for the frontier tier.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(apiError(body, `Claude answered HTTP ${res.status}.`));
  const text = (Array.isArray(body?.content) ? body.content : [])
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => String(block.text || ''))
    .join('')
    .trim();
  if (!text) throw new Error('Claude returned an empty response — try again.');
  const reported = Number(body?.usage?.output_tokens);
  return { text, tokens: Number.isFinite(reported) && reported > 0 ? reported : estimateTokens(text) };
}

function readJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The director did not return readable JSON.');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

function stripFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:tsx|ts|typescript|jsx|javascript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// CALL 1 — PLAN
// ---------------------------------------------------------------------------

function normalizeManifest(raw: any, style: StyleOption, narration: boolean): Manifest {
  const rawScenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
  const scenes: ManifestScene[] = rawScenes.slice(0, 3).map((scene: any, index: number) => ({
    duration: Math.min(5, Math.max(2, Number(scene?.duration) || 3)),
    description: String(scene?.description || `Scene ${index + 1}`).trim(),
    mood: String(scene?.mood || 'confident').trim(),
  }));
  if (!scenes.length) {
    throw new Error('The director returned no scenes — try describing the video again.');
  }
  const palette = (Array.isArray(raw?.palette) ? raw.palette : [])
    .filter((color: unknown) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    .slice(0, 5);
  return {
    scenes,
    style: style.id,
    palette: palette.length >= 2 ? palette : style.palette,
    hasNarration: narration,
  };
}

export async function callPlan(input: {
  prompt: string;
  style: StyleOption;
  narration: boolean;
}): Promise<{ manifest: Manifest; tokens: number }> {
  const system = [
    'You are the director of a short SaaS product video.',
    'Return ONLY a JSON scene manifest. No code, no prose, no markdown fence.',
    '',
    'Schema:',
    '{"scenes":[{"duration":<seconds, 2-5>,"description":"<one sentence of concrete on-screen content>","mood":"<one or two words>"}],"style":"<style id>","palette":["#RRGGBB"],"hasNarration":<boolean>}',
    '',
    'Rules:',
    '- Three scenes maximum. Two is often better.',
    '- Each description names what is literally on screen, not how it feels.',
    '- The palette is 3 to 5 hex colours matching the requested style.',
    '- Nothing outside the JSON object.',
  ].join('\n');

  const user = [
    `Video request: ${input.prompt.trim()}`,
    `Style id: ${input.style.id}`,
    `Style direction: ${input.style.direction}`,
    `Narration: ${input.narration ? 'yes — a voice track will be recorded' : 'no'}`,
  ].join('\n');

  const res = await opus(system, user, 2000);
  return { manifest: normalizeManifest(readJson<any>(res.text), input.style, input.narration), tokens: res.tokens };
}

/** The one-line summary the agent feed shows under the Planning step. */
export function planSummary(manifest: Manifest, style: StyleOption): string {
  const count = manifest.scenes.length;
  return `"${count} scene${count === 1 ? '' : 's'}, ${style.label.toLowerCase()}, ${manifest.palette[1] || manifest.palette[0]} palette"`;
}

// ---------------------------------------------------------------------------
// CALL 2 — COMPOSE
// ---------------------------------------------------------------------------

/** Baked into every Compose call verbatim. Do not reword it — the whole
 * token discipline of this pipeline lives in these eleven rules. */
export const COMPACT_DIRECTIVE = `CRITICAL: MAXIMUM TOKEN BUDGET — STAY UNDER 1,500 TOKENS

You are writing a single-file Remotion composition for a headless server-side render pipeline. Absolute rules:

1. Under 200 lines total. No comments, no boilerplate, no mock data arrays.
2. Single file: all types, helpers, sub-components in one file.
3. Map over arrays of max 3 items — never repeat JSX blocks.
4. Only import from 'remotion': AbsoluteFill, Img, Video, interpolate, spring, useCurrentFrame, useVideoConfig, Easing.
5. Canvas: width={1920} height={1080} fps={30}. Vertical layout: wrap in a centered 607×1080 sub-frame inside AbsoluteFill.
6. Background video: <Video src={props.backgroundVideoUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} muted /> as base layer — raw HTTPS GCS URL, never staticFile().
7. Dark glassmorphic cards: dark gradient backgrounds, backdrop-filter blur, amber/orange text (#f59e0b).
8. Timing: const { durationInFrames } = useVideoConfig() — NO hardcoded frame constants.
9. Never access window, document, localStorage.
10. Inline React styles only — no Tailwind, no CSS imports.
11. End with: export default YourComponentName; — complete, no truncation.`;

/** Addenda are appended AFTER the directive so rule 11 is never disturbed. */
function composeSystem(style: StyleOption, narration: boolean): string {
  const parts = [
    COMPACT_DIRECTIVE,
    '',
    `ART DIRECTION\n${style.direction}`,
    '',
    'ADDENDUM A — BACKGROUND FALLBACK',
    'props.backgroundVideoUrl may be an empty string. When it is, omit the <Video> layer entirely and use a dark gradient AbsoluteFill as the base layer instead.',
  ];
  if (narration) {
    parts.push(
      '',
      'ADDENDUM B — NARRATION',
      "A voice track is supplied on props.narrationUrl. Also import Audio from 'remotion' and render <Audio src={props.narrationUrl} /> as the first child of the outer AbsoluteFill. Audio is still a 'remotion' import, so rule 4 holds.",
    );
  }
  parts.push('', 'Return ONLY the TSX source. No markdown fence, no explanation.');
  return parts.join('\n');
}

export async function callCompose(input: {
  manifest: Manifest;
  style: StyleOption;
  narration: boolean;
  fix?: string;
}): Promise<{ code: string; tokens: number; lines: number }> {
  const user = [
    'Scene manifest:',
    JSON.stringify(input.manifest, null, 2),
    '',
    'Props your default-exported component receives:',
    '  backgroundVideoUrl: string   // raw HTTPS GCS URL, may be an empty string',
    '  narrationUrl: string         // empty string when narration is off',
    '  palette: string[]            // hex colours from the manifest',
    '  scenes: { duration: number; description: string; mood: string }[]',
    '',
    'Do NOT export calculateDemoVideoDuration and do NOT hardcode a frame count anywhere: the platform injects durationInFrames, so read it from useVideoConfig() and derive every scene boundary from it.',
    input.fix ? `\nFIX REQUIRED FROM THE PREVIOUS ATTEMPT: ${input.fix}` : '',
  ].join('\n');

  // max_tokens sits above TOKEN_BUDGET because Opus thinking shares the
  // ceiling; the budget itself is enforced on the returned code below.
  const res = await opus(composeSystem(input.style, input.narration), user, 6000);
  const code = stripFence(res.text);
  return { code, tokens: res.tokens, lines: code.split('\n').length };
}

// ---------------------------------------------------------------------------
// CALL 3 — VALIDATE
// ---------------------------------------------------------------------------

/** Deterministic checks that never need a model call. Catching truncation and
 * banned globals here keeps the paid validation call for the subtle stuff. */
export function localCheck(code: string): Verdict | null {
  if (code.length < 400) {
    return { valid: false, issue: 'The composition came back almost empty.', fix: 'Write the complete composition in one pass.' };
  }
  if (!/export\s+default\s+\w+/.test(code)) {
    return { valid: false, issue: 'No `export default` — the file is truncated.', fix: 'Finish the file and end with `export default YourComponentName;`.' };
  }
  const imports = Array.from(code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
  const stray = imports.find((source) => source !== 'remotion' && source !== 'react');
  if (stray) {
    return { valid: false, issue: `Imports \`${stray}\` — only 'remotion' is available.`, fix: "Import only from 'remotion'." };
  }
  if (/\bstaticFile\s*\(/.test(code)) {
    return { valid: false, issue: 'Calls staticFile(), which the headless renderer has no files for.', fix: 'Use the raw HTTPS URLs from props instead of staticFile().' };
  }
  const global = /\b(window|document|localStorage)\s*\./.exec(code);
  if (global) {
    return { valid: false, issue: `Touches \`${global[1]}\`, which does not exist in the render sandbox.`, fix: 'Remove every browser global; drive everything from useCurrentFrame().' };
  }
  if (!/useVideoConfig\s*\(/.test(code)) {
    return { valid: false, issue: 'Does not read useVideoConfig() — timing is hardcoded.', fix: 'Derive all timing from `const { durationInFrames } = useVideoConfig()`.' };
  }
  const open = (code.match(/{/g) || []).length;
  const close = (code.match(/}/g) || []).length;
  if (open !== close) {
    return { valid: false, issue: 'Unbalanced braces — the file stopped mid-render.', fix: 'Return a complete, balanced file.' };
  }
  return null;
}

export function budgetCheck(tokens: number): Verdict | null {
  if (tokens <= TOKEN_BUDGET) return null;
  return {
    valid: false,
    issue: `${tokens} tokens — over the ${TOKEN_BUDGET} budget.`,
    fix: `Rewrite it shorter: under ${TOKEN_BUDGET} tokens and under 200 lines, mapping over the scenes array instead of repeating JSX.`,
  };
}

export async function callValidate(code: string): Promise<{ verdict: Verdict; tokens: number }> {
  const system = [
    'You are a strict reviewer for headless server-side Remotion renders.',
    'Answer with ONLY JSON: {"valid":true} or {"valid":false,"issue":"<one line>","fix":"<one line instruction for the author>"}.',
    '',
    'Fail the composition when any of these are true:',
    '- it is truncated, or missing its final `export default`',
    "- it imports anything other than 'remotion'",
    '- it calls staticFile()',
    '- it touches window, document or localStorage',
    '- it hardcodes a frame count instead of reading useVideoConfig().durationInFrames',
    '- JSX tags or braces are unbalanced',
    '',
    'Otherwise pass it. Do not nitpick taste.',
  ].join('\n');

  const res = await opus(system, `Composition under review:\n\n${code}`, 2000);
  const raw = readJson<any>(res.text);
  return {
    verdict: {
      valid: raw?.valid === true,
      issue: typeof raw?.issue === 'string' ? raw.issue : undefined,
      fix: typeof raw?.fix === 'string' ? raw.fix : undefined,
    },
    tokens: res.tokens,
  };
}

// ---------------------------------------------------------------------------
// Background plate — Gemini Omni Flash
// ---------------------------------------------------------------------------

function platePrompt(manifest: Manifest, style: StyleOption): string {
  const moods = manifest.scenes.map((s) => s.mood).filter(Boolean).slice(0, 3).join(', ');
  const prompt = [
    'Abstract out-of-focus background plate for a SaaS product video.',
    style.direction,
    moods ? `Mood: ${moods}.` : '',
    `Palette: ${manifest.palette.join(', ')}.`,
    'Slow drifting camera, soft bokeh and gentle light movement.',
    'Atmosphere only: absolutely no text, no logos, no user interface, no people.',
    // The Google video routes expose no seed parameter, so the shared VidVerge
    // seed travels as a prompt suffix — it keeps this plate in the same visual
    // family as anything Ads Studio or SceneForge made in this browser.
    seedPromptSuffix(ensureScriptToVideoSeed()),
  ].filter(Boolean).join(' ');
  return prompt.slice(0, 1000);
}

/** Generates the base layer clip. A failure is NOT fatal — the composition is
 * told to fall back to a gradient when the URL comes back empty. */
export async function generateBackgroundPlate(
  manifest: Manifest,
  style: StyleOption,
  onNote: (line: string) => void,
): Promise<string> {
  const token = await waitForToken();
  const headers = { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token, 'X-App-Id': appId() };
  const submit = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gemini-omni-flash-preview',
      prompt: platePrompt(manifest, style),
      aspectRatio: '16:9',
      duration: 8,
      generateAudio: false,
    }),
  });
  const submitted = await submit.json().catch(() => null);
  const operationId = String(submitted?.operationId || '');
  if (!submit.ok || !operationId) {
    onNote(`Background video unavailable (${apiError(submitted, `HTTP ${submit.status}`)}) — falling back to a gradient.`);
    return '';
  }

  for (let attempt = 0; attempt < 72; attempt += 1) {
    await sleep(5000);
    const res = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, { headers });
    const status = await res.json().catch(() => null);
    const state = String(status?.status || '').toLowerCase();
    if (state === 'completed' && status?.videoUrl) return String(status.videoUrl);
    if (state === 'failed') {
      onNote(`Background video failed (${apiError(status, 'the model gave no reason')}) — falling back to a gradient.`);
      return '';
    }
  }
  onNote('Background video timed out — falling back to a gradient.');
  return '';
}

// ---------------------------------------------------------------------------
// Narration — text-to-speech, then a voice-derived frame count
// ---------------------------------------------------------------------------

export function narrationScript(manifest: Manifest): string {
  return manifest.scenes.map((scene) => scene.description).join(' ').slice(0, 3800);
}

function measureAudio(url: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000);
    audio.src = url;
  });
}

/** Roughly 2.6 spoken words a second — only used when the browser refuses to
 * report a duration for the returned MP3. */
function estimateSpokenSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(3, words / 2.6);
}

export async function generateNarration(text: string): Promise<{ url: string; seconds: number }> {
  const token = await waitForToken();
  const res = await fetch('/proxy/openai/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(apiError(body, `The narration engine answered HTTP ${res.status}.`));
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const measured = await measureAudio(objectUrl);
  URL.revokeObjectURL(objectUrl);

  // The renderer runs server-side, so the clip needs a durable public URL.
  const form = new FormData();
  form.append('file', new File([blob], `saas-video-narration-${Date.now()}.mp3`, { type: blob.type || 'audio/mpeg' }));
  form.append('folder', 'saas-video');
  form.append('workspaceId', workspaceId());
  const upload = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token, 'X-App-Id': appId() },
    body: form,
  });
  const uploaded = await upload.json().catch(() => null);
  if (!upload.ok || !uploaded?.url) {
    throw new Error(apiError(uploaded, `The narration could not be stored (HTTP ${upload.status}).`));
  }
  return { url: String(uploaded.url), seconds: measured || estimateSpokenSeconds(text) };
}

/** Narration on: the voice decides the length. Narration off: a flat 90 frames
 * a scene. Either way the number is injected, never hardcoded in the TSX. */
export function frameCount(manifest: Manifest, narrationSeconds: number | null): number {
  if (narrationSeconds && narrationSeconds > 0) {
    return Math.min(18000, Math.max(FPS, Math.ceil((narrationSeconds + 0.6) * FPS)));
  }
  return Math.min(18000, manifest.scenes.length * DEFAULT_SCENE_FRAMES);
}

// ---------------------------------------------------------------------------
// CALL 4 — RENDER (platform Remotion service)
// ---------------------------------------------------------------------------

export async function renderComposition(input: {
  compositionTsx: string;
  props: CompositionProps;
  durationInFrames: number;
  onNote: (line: string) => void;
}): Promise<string> {
  const token = await waitForToken();
  const headers = { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
  const submit = await fetch('/api/render/remotion', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workspaceId: workspaceId(),
      compositionTsx: input.compositionTsx,
      props: input.props,
      durationInFrames: input.durationInFrames,
      fps: FPS,
      width: 1920,
      height: 1080,
    }),
  });
  const submitted = await submit.json().catch(() => null);
  if (submit.status === 402) {
    throw new Error('Your workspace wallet needs funds before this video can be rendered.');
  }
  const operationId = String(submitted?.operationId || '');
  if (!submit.ok || submitted?.success === false || !operationId) {
    throw new Error(apiError(submitted, `The render could not be started (HTTP ${submit.status}).`));
  }

  input.onNote('Compositing…');
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await sleep(3000);
    const res = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`, { headers });
    const status = await res.json().catch(() => null);
    if (!res.ok || status?.success === false) {
      throw new Error(apiError(status, `Could not read the render status (HTTP ${res.status}).`));
    }
    const state = String(status?.status || '').toLowerCase();
    const url = status?.videoUrl || status?.video_url || status?.downloadUrl;
    if ((state === 'complete' || state === 'completed') && url) return String(url);
    if (state === 'failed' || state === 'error') throw new Error(apiError(status, 'The Remotion render failed.'));
  }
  throw new Error('The render is taking longer than expected — retry it from the Rendering step.');
}

// ---------------------------------------------------------------------------
// Persistence (WorkspaceDB — stv_projects)
// ---------------------------------------------------------------------------

function wdb(): any {
  return runtime()?.__workspaceDb || null;
}

export function projectTitle(prompt: string): string {
  const first = prompt.trim().split('\n')[0].trim();
  return (first.length > 64 ? `${first.slice(0, 61)}…` : first) || 'Untitled video';
}

export async function saveProject(row: Partial<ProjectRow>): Promise<void> {
  const db = wdb();
  if (!db) return;
  try {
    await db.from('stv_projects').insert(row);
  } catch (error) {
    console.warn('[SaaS Video] Could not save the project row:', error);
  }
}

export async function listProjects(): Promise<ProjectRow[]> {
  const db = wdb();
  if (!db) return [];
  try {
    const { data } = await db.from('stv_projects').orderBy('created_at', 'desc').limit(24).get();
    return (Array.isArray(data) ? data : []).filter((row: ProjectRow) => row && row.render_url);
  } catch {
    return [];
  }
}

export function fmtDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
