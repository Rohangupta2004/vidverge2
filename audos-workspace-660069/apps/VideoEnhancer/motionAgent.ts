/**
 * Motion Graphics Agent — analyzes the uploaded video (word-timed transcript +
 * the video's REAL pixel geometry) and asks the workspace AI proxy for a
 * timeline of professional animated overlay elements. overlayCanvas.ts draws
 * the plan live on a canvas above the player and bakes it into the
 * MediaRecorder export.
 *
 * Transcription tries the OpenAI Whisper proxy first
 * (POST /proxy/openai/v1/audio/transcriptions, model whisper-1, word
 * timestamps) and falls back to the workspace's word-timed transcription
 * pipeline (transcribeVideo) so the agent still works where the Whisper route
 * is unavailable.
 */
import { TranscriptWord, transcribeVideo, workspaceToken } from './enhancerCore';

export type OverlayType =
  | 'text' | 'highlight_box' | 'arrow' | 'circle' | 'underline'
  | 'callout_label' | 'icon' | 'stat_card' | 'progress_bar' | 'particle_burst';

export interface MotionOverlayStyle {
  color: string;
  backgroundColor: string;
  borderColor: string;
  /** Relative to video height (0.03 = 3% of the frame height). */
  fontSize: number;
  fontWeight: string;
  opacity: number;
  borderRadius: number;
  blur: number;
}

export interface MotionOverlay {
  id: string;
  type: OverlayType;
  startTime: number;
  endTime: number;
  /** 0–1 fraction of video width (left edge). */
  x: number;
  /** 0–1 fraction of video height (top edge). */
  y: number;
  width: number;
  height: number;
  content: string;
  animateIn: string;
  animateOut: string;
  animateDuration: number;
  style: MotionOverlayStyle;
  tracking: null | { description: string };
}

const OVERLAY_TYPES: readonly string[] = [
  'text', 'highlight_box', 'arrow', 'circle', 'underline',
  'callout_label', 'icon', 'stat_card', 'progress_bar', 'particle_burst',
];
const ANIMS_IN: readonly string[] = ['fade', 'slide_up', 'slide_left', 'scale_pop', 'typewriter'];
const ANIMS_OUT: readonly string[] = ['fade', 'slide_down', 'scale_out'];
const MAX_OVERLAYS = 30;

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// ---------------------------------------------------------------------------
// Transcription (Whisper proxy first, Deepgram word-timed pipeline fallback)
// ---------------------------------------------------------------------------

async function transcribeWithWhisper(file: File): Promise<{ words: TranscriptWord[]; transcript: string }> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const form = new FormData();
  form.append('file', file, file.name || 'video.mp4');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch('/proxy/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && data.error ? (typeof data.error === 'string' ? data.error : data.error.message || '') : '';
    throw new Error(detail || ('Whisper transcription failed (HTTP ' + res.status + ').'));
  }
  const words: TranscriptWord[] = Array.isArray(data && data.words)
    ? data.words
        .filter((w: any) => w && typeof w.word === 'string' && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
        .map((w: any) => ({ word: String(w.word), start: Number(w.start), end: Number(w.end) }))
    : [];
  return { words, transcript: String((data && data.text) || '').trim() };
}

/**
 * Word-timed transcript for the agent: Whisper proxy first, then the app's
 * proven word-timed pipeline as fallback (which itself has WAV + plain-text
 * fallbacks), so one unavailable route never blocks the agent.
 */
export async function getWordTranscript(file: File, onNote?: (note: string) => void): Promise<{ words: TranscriptWord[]; transcript: string }> {
  onNote?.('Transcribing the audio (Whisper)…');
  try {
    const t = await transcribeWithWhisper(file);
    if (t.words.length || t.transcript) return t;
  } catch { /* fall through to the workspace pipeline */ }
  onNote?.('Whisper route unavailable — using the workspace transcription service…');
  const t = await transcribeVideo(file, onNote);
  return { words: t.words, transcript: t.transcript };
}

// ---------------------------------------------------------------------------
// LLM overlay planning
// ---------------------------------------------------------------------------

export const MOTION_DIRECTOR_SYSTEM_PROMPT = [
  'You are a professional motion graphics director. Given a video transcript with timestamps and video metadata, generate a timeline of animated overlay elements that will enhance the video professionally.',
  '',
  'Rules:',
  '- Only add overlays that correspond to actual content moments (match timestamps precisely)',
  '- Do NOT cover faces, product UI, or important visual content — prefer the lower third and the edges of the frame',
  '- Do NOT overcrowd — max 2 elements on screen at any time',
  '- Use visual hierarchy: major points get larger/bolder elements, minor emphasis gets subtle highlights',
  '- Keep a consistent visual language throughout',
  '- Prefer subtle, premium animations over flashy effects',
  '- Every element must have a clear purpose tied to the content',
  '- All x/y/width/height are FRACTIONS (0-1) of the REAL video frame given in the metadata — respect its aspect ratio (a vertical 9:16 frame is much taller than wide)',
  '',
  'For each overlay element, output a JSON object with this schema:',
  '{',
  '  "id": string,',
  '  "type": "text" | "highlight_box" | "arrow" | "circle" | "underline" | "callout_label" | "icon" | "stat_card" | "progress_bar" | "particle_burst",',
  '  "startTime": number,  // seconds',
  '  "endTime": number,    // seconds',
  '  "x": number,          // 0-1 (fraction of video width, left edge of element)',
  '  "y": number,          // 0-1 (fraction of video height, top edge of element)',
  '  "width": number,      // 0-1 fraction of video width',
  '  "height": number,     // 0-1 fraction of video height',
  '  "content": string,    // text, icon name/emoji, stat value ("87%|Accuracy" for stat cards), etc.',
  '  "animateIn": "fade" | "slide_up" | "slide_left" | "scale_pop" | "typewriter",',
  '  "animateOut": "fade" | "slide_down" | "scale_out",',
  '  "animateDuration": number,  // seconds for in/out animation',
  '  "style": {',
  '    "color": string,           // hex',
  '    "backgroundColor": string, // hex or "transparent"',
  '    "borderColor": string,',
  '    "fontSize": number,        // relative to video height (e.g. 0.03 = 3% of height)',
  '    "fontWeight": "normal" | "bold" | "black",',
  '    "opacity": number,         // 0-1',
  '    "borderRadius": number,    // px',
  '    "blur": number             // backdrop blur px, 0 for none',
  '  },',
  '  "tracking": null | { "description": string }  // if the element should follow a moving target, describe it',
  '}',
  '',
  'Return ONLY a valid JSON array. No markdown, no explanation.',
].join('\n');

function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last <= first) throw new Error('The AI plan came back in an unexpected format — try again.');
  const parsed: unknown = JSON.parse(cleaned.slice(first, last + 1));
  if (!Array.isArray(parsed)) throw new Error('The AI plan was not a list — try again.');
  return parsed;
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function hexish(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 48) : fallback;
}

function sanitizeOverlay(raw: unknown, index: number, durationSec: number): MotionOverlay | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const type: OverlayType = typeof r.type === 'string' && OVERLAY_TYPES.includes(r.type) ? (r.type as OverlayType) : 'text';
  const start = clamp(num(r.startTime, -1), 0, Math.max(0.3, durationSec - 0.3));
  let end = clamp(num(r.endTime, -1), 0, durationSec);
  if (num(r.startTime, -1) < 0 || num(r.endTime, -1) < 0) return null;
  if (end <= start + 0.25) end = Math.min(durationSec, start + 1.5);
  if (end <= start + 0.2) return null;
  const x = clamp(num(r.x, 0.1), 0, 0.98);
  const y = clamp(num(r.y, 0.75), 0, 0.98);
  const width = clamp(num(r.width, 0.3), 0.02, 1 - x);
  const height = clamp(num(r.height, 0.08), 0.02, 1 - y);
  const s = (typeof r.style === 'object' && r.style !== null ? r.style : {}) as Record<string, unknown>;
  const fontWeightRaw = typeof s.fontWeight === 'string' ? s.fontWeight : 'bold';
  const trackRaw = r.tracking;
  const tracking = typeof trackRaw === 'object' && trackRaw !== null && typeof (trackRaw as any).description === 'string'
    ? { description: String((trackRaw as any).description).slice(0, 160) }
    : null;
  return {
    id: typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 48) : 'ovl-' + index + '-' + Date.now().toString(36),
    type,
    startTime: Math.round(start * 100) / 100,
    endTime: Math.round(end * 100) / 100,
    x, y, width, height,
    content: typeof r.content === 'string' ? r.content.slice(0, 90) : '',
    animateIn: typeof r.animateIn === 'string' && ANIMS_IN.includes(r.animateIn) ? r.animateIn : 'fade',
    animateOut: typeof r.animateOut === 'string' && ANIMS_OUT.includes(r.animateOut) ? r.animateOut : 'fade',
    animateDuration: clamp(num(r.animateDuration, 0.4), 0.15, 1.5),
    style: {
      color: hexish(s.color, '#FFFFFF'),
      backgroundColor: hexish(s.backgroundColor, 'transparent'),
      borderColor: hexish(s.borderColor, hexish(s.color, '#3B82F6')),
      fontSize: clamp(num(s.fontSize, 0.035), 0.012, 0.12),
      fontWeight: fontWeightRaw === 'normal' || fontWeightRaw === 'black' ? fontWeightRaw : 'bold',
      opacity: clamp(num(s.opacity, 1), 0.1, 1),
      borderRadius: clamp(num(s.borderRadius, 10), 0, 60),
      blur: clamp(num(s.blur, 0), 0, 24),
    },
    tracking,
  };
}

/** Never more than 2 overlays on screen at once — extra concurrent ones are dropped. */
function limitConcurrency(overlays: MotionOverlay[]): MotionOverlay[] {
  const kept: MotionOverlay[] = [];
  for (const o of overlays) {
    const concurrent = kept.filter((k) => k.startTime < o.endTime && o.startTime < k.endTime).length;
    if (concurrent < 2) kept.push(o);
  }
  return kept;
}

/** Word list → compact timestamped lines the model can align overlays to. */
function transcriptLines(words: TranscriptWord[]): string {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 12) {
    const chunk = words.slice(i, i + 12);
    lines.push(chunk[0].start.toFixed(1) + '-' + chunk[chunk.length - 1].end.toFixed(1) + 's: ' + chunk.map((w) => w.word).join(' '));
    if (lines.length >= 220) break;
  }
  return lines.join('\n');
}

/**
 * One gpt-5.6-terra pass: transcript + REAL frame geometry in, a validated
 * MotionOverlay timeline out. Every coordinate is clamped, unknown types and
 * animations fall back to safe defaults, and concurrency is capped at 2.
 */
export async function generateOverlayPlan(input: {
  words: TranscriptWord[];
  transcript: string;
  durationSec: number;
  width: number;
  height: number;
}): Promise<MotionOverlay[]> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const { words, transcript, durationSec, width, height } = input;
  const aspectRatio = height > 0 ? Math.round((width / height) * 1000) / 1000 : 16 / 9;
  const orientation = height > width ? 'vertical (portrait, 9:16-like)' : width > height ? 'landscape (16:9-like)' : 'square';
  const meta = { durationSec: Math.round(durationSec * 10) / 10, width, height, aspectRatio, orientation };
  const body = words.length
    ? 'TRANSCRIPT WITH TIMESTAMPS (start-end seconds: words):\n' + transcriptLines(words)
    : 'TRANSCRIPT (no word timestamps available — distribute overlays sensibly across the duration):\n' + transcript.slice(0, 6000);
  const userContent = [
    'VIDEO METADATA:',
    JSON.stringify(meta),
    '',
    body,
    '',
    'Plan 4 to 14 overlay elements for this video. Remember: coordinates are fractions of a ' + width + 'x' + height + ' ' + orientation + ' frame, max 2 elements on screen at once, and every element must map to a real content moment.',
  ].join('\n');

  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: MOTION_DIRECTOR_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && data.error ? (typeof data.error === 'string' ? data.error : data.error.message || '') : '';
    throw new Error(detail || ('AI request failed (HTTP ' + res.status + ').'));
  }
  const first = data && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = first && first.message && typeof first.message.content === 'string' ? first.message.content : '';
  if (!content.trim()) throw new Error('The AI returned an empty response — try again.');

  let plan: MotionOverlay[];
  try {
    plan = extractJsonArray(content)
      .map((raw, i) => sanitizeOverlay(raw, i, durationSec))
      .filter((o): o is MotionOverlay => o !== null)
      .slice(0, MAX_OVERLAYS);
  } catch (e) {
    throw new Error('Could not read the AI plan (' + msg(e) + ') — try again.');
  }
  plan.sort((a, b) => a.startTime - b.startTime);
  return limitConcurrency(plan);
}
