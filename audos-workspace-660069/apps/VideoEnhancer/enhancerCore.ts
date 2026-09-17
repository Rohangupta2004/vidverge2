/**
 * Video Enhancer — platform API core.
 *
 * Fully self-contained (imports NOTHING from Track A or Track B code). Covers
 * the whole enhancement pipeline against documented platform integrations:
 *   1. Upload           → POST /api/upload/file            (file-storage)
 *   2. Transcription    → POST /api/workspaces/:id/audio/transcribe-timestamped
 *                         (deepgram-transcription; WAV extraction fallback)
 *   3. Enhancement plan → POST /proxy/anthropic/v1/messages (claude-sonnet-5)
 *   4. B-roll           → POST /api/veo/generate/video + /api/veo/status/:op
 *   5. Export           → POST /api/render/remotion + GET /api/render/remotion/:op
 */

export const WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
export const ACCENT = '#3B82F6';

/** The visitor's workspace token — required by every platform proxy call. */
export function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function appId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || '');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptWord { word: string; start: number; end: number }

export interface CaptionWord { t: string; s: number; e: number; em?: boolean }

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
  enabled: boolean;
}

export interface GraphicCue {
  id: string;
  at: number;
  duration: number;
  text: string;
  kind: 'title' | 'keyword';
  enabled: boolean;
}

export type BrollStatus = 'idle' | 'generating' | 'done' | 'failed';

export interface BrollSlot {
  id: string;
  at: number;
  duration: number;
  prompt: string;
  enabled: boolean;
  status: BrollStatus;
  operationId?: string | null;
  videoUrl?: string | null;
  error?: string | null;
}

export type EffectPresetId = 'none' | 'cinematic' | 'warm' | 'noir' | 'vivid';

export interface EffectSettings {
  preset: EffectPresetId;
  vignette: boolean;
  grain: boolean;
  punchIn: boolean;
}

export type CaptionPresetId = 'boldpop' | 'clean' | 'karaoke' | 'neon';

export const CAPTION_PRESETS: { id: CaptionPresetId; label: string; hint: string }[] = [
  { id: 'boldpop', label: 'Bold Pop', hint: 'Big uppercase captions, the active word pops — built for social.' },
  { id: 'clean', label: 'Clean Pill', hint: 'Sentence-case captions on a soft dark pill — calm and readable.' },
  { id: 'karaoke', label: 'Karaoke Fill', hint: 'Words light up in brand blue as they are spoken.' },
  { id: 'neon', label: 'Neon Glow', hint: 'Glowing caption text with an electric halo on the spoken word.' },
];

export const EFFECT_PRESETS: { id: EffectPresetId; label: string; hint: string }[] = [
  { id: 'none', label: 'Original', hint: 'No colour grade — footage exactly as shot.' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Deeper contrast with a subtle cool teal push.' },
  { id: 'warm', label: 'Warm Film', hint: 'Golden, gently faded film look.' },
  { id: 'noir', label: 'Noir', hint: 'Punchy black & white.' },
  { id: 'vivid', label: 'Vivid', hint: 'Saturated, high-energy colour.' },
];

export function cssFilterFor(preset: EffectPresetId): string {
  switch (preset) {
    case 'cinematic': return 'contrast(1.1) saturate(1.18) hue-rotate(-6deg) brightness(1.02)';
    case 'warm': return 'sepia(0.24) saturate(1.22) contrast(1.05) brightness(1.05)';
    case 'noir': return 'grayscale(1) contrast(1.16) brightness(1.02)';
    case 'vivid': return 'saturate(1.5) contrast(1.08)';
    default: return 'none';
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// 1. Upload (file-storage integration — public workspace-scoped upload)
// ---------------------------------------------------------------------------

// PRD 3.5: the enhancer accepts files up to 500MB. The platform's buffered
// /api/upload/file route is hard-capped at 50MB server-side, so anything
// larger goes through the signed direct-to-GCS route (/api/upload/signed-url,
// up to 500MB). On hosts where the platform cannot resolve an app context for
// the signed grant, a large upload fails with an honest, actionable message
// instead of a silent server rejection.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const BUFFERED_UPLOAD_BYTES = 50 * 1024 * 1024; // /api/upload/file server-side ceiling

async function uploadVideoBuffered(file: File): Promise<{ url: string; bytes: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('workspaceId', WORKSPACE_UUID);
  form.append('folder', 'video-enhancer');
  const headers: Record<string, string> = {};
  const id = appId();
  if (id) headers['X-App-Id'] = id;
  const token = workspaceToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  const res = await fetch('/api/upload/file', { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.url) {
    throw new Error((data?.error as string) || ('Upload failed (HTTP ' + res.status + ').'));
  }
  return { url: data.url as string, bytes: Number(data.bytes) || file.size };
}

/** Signed direct-to-GCS upload for files over the 50MB buffered ceiling. */
async function uploadVideoSigned(file: File): Promise<{ url: string; bytes: number }> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const contentType = file.type || 'video/mp4';
  const grantRes = await fetch('/api/upload/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ size: file.size, contentType }),
  });
  const grant = await grantRes.json().catch(() => null);
  if (!grantRes.ok || !grant?.uploadUrl || !grant?.key) {
    const code = String(grant?.error || '');
    if (grantRes.status === 404 || /app_context_not_found/i.test(code)) {
      throw new Error('Files over 50 MB need the platform\u2019s large-upload channel, which is not available on this page yet — trim or compress the video to under 50 MB and upload again.');
    }
    throw new Error(code || ('The large upload could not be authorized (HTTP ' + grantRes.status + ').'));
  }
  const put = await fetch(String(grant.uploadUrl), {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-goog-content-length-range': file.size + ',' + file.size,
      'x-goog-if-generation-match': '0',
    },
    body: file,
  });
  if (!put.ok) throw new Error('The large upload failed (HTTP ' + put.status + ') — try again.');
  // The signed PUT URL minus its query string is the durable public address.
  return { url: String(grant.uploadUrl).split('?')[0], bytes: file.size };
}

export async function uploadVideo(file: File): Promise<{ url: string; bytes: number }> {
  if (file.size <= BUFFERED_UPLOAD_BYTES) return uploadVideoBuffered(file);
  return uploadVideoSigned(file);
}

// ---------------------------------------------------------------------------
// 2. Transcription (deepgram-transcription — word-level timestamps)
// ---------------------------------------------------------------------------

async function postTranscription(blob: Blob, filename: string): Promise<{ transcript: string; words: TranscriptWord[]; duration: number }> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const form = new FormData();
  form.append('audio', blob, filename);
  const res = await fetch('/api/workspaces/' + WORKSPACE_UUID + '/audio/transcribe-timestamped', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error((data?.error as string) || ('Transcription failed (HTTP ' + res.status + ').'));
  }
  const words: TranscriptWord[] = Array.isArray(data.words)
    ? data.words
        .filter((w: any) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
        .map((w: any) => ({ word: String(w.word), start: Number(w.start), end: Number(w.end) }))
    : [];
  return { transcript: String(data.transcript || ''), words, duration: Number(data.duration) || 0 };
}

/**
 * Plain-text transcription fallback (audio-transcription integration:
 * POST /api/generate/transcribe, multipart field `audio`, accepted formats
 * .webm/.mp3/.wav/.m4a/.ogg). Returns no word timestamps — used only when the
 * word-timed endpoint is unavailable so the creator still gets a transcript.
 */
async function postPlainTranscription(blob: Blob, filename: string): Promise<{ transcript: string; words: TranscriptWord[]; duration: number }> {
  const form = new FormData();
  form.append('audio', blob, filename);
  const headers: Record<string, string> = {};
  const token = workspaceToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  const res = await fetch('/api/generate/transcribe', { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.text !== 'string') {
    throw new Error((data?.error as string) || ('Transcription failed (HTTP ' + res.status + ').'));
  }
  return { transcript: String(data.text || '').trim(), words: [], duration: 0 };
}

/** Extract the audio track of a video file as a 16 kHz mono WAV blob (browser-side, no ffmpeg). */
async function extractWavAudio(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error('This browser cannot decode audio locally.');
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    try { ctx.close(); } catch { /* no-op */ }
  }
  const rate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return encodeWavPcm16(rendered.getChannelData(0), rate);
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Transcribe the uploaded video with word timestamps. Tries the video file
 * directly first (Deepgram reads MP4/WebM audio tracks); if the endpoint
 * refuses the container, extracts a mono WAV in the browser and retries.
 */
export async function transcribeVideo(file: File, onNote?: (note: string) => void): Promise<{ transcript: string; words: TranscriptWord[]; duration: number }> {
  let directErr: unknown;
  try {
    return await postTranscription(file, file.name || 'video.mp4');
  } catch (e) {
    directErr = e;
  }
  onNote?.('Direct transcription refused the video container — extracting the audio track locally and retrying…');
  let wav: Blob;
  try {
    wav = await extractWavAudio(file);
  } catch (wavErr) {
    const d = directErr instanceof Error ? directErr.message : String(directErr);
    const w = wavErr instanceof Error ? wavErr.message : String(wavErr);
    throw new Error('Transcription failed. Direct: ' + d + ' — Audio-extract fallback: ' + w);
  }
  try {
    return await postTranscription(wav, 'audio.wav');
  } catch (tsErr) {
    // Word-timed transcription is out — fall back to the plain-text service so
    // the creator still gets their transcript (captions need word timings, so
    // they stay empty on this path and the UI says so).
    onNote?.('Word-timed transcription is unavailable — trying the plain transcription service…');
    try {
      return await postPlainTranscription(wav, 'audio.wav');
    } catch (plainErr) {
      const d = directErr instanceof Error ? directErr.message : String(directErr);
      const t = tsErr instanceof Error ? tsErr.message : String(tsErr);
      const p = plainErr instanceof Error ? plainErr.message : String(plainErr);
      throw new Error('Transcription failed. Direct: ' + d + ' — WAV: ' + t + ' — Plain fallback: ' + p);
    }
  }
}

/**
 * Rebuild a File from the durable stored URL — lets a restored session (page
 * reload, new tab, fresh sign-in) re-run transcription and audio analysis
 * without asking the creator to upload the same video again.
 */
export async function fetchVideoAsFile(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load the stored video (HTTP ' + res.status + ').');
  const blob = await res.blob();
  const name = url.split('?')[0].split('/').pop() || 'video.mp4';
  return new File([blob], name, { type: blob.type || 'video/mp4' });
}

// ---------------------------------------------------------------------------
// Caption building (deterministic, word-accurate)
// ---------------------------------------------------------------------------

export function buildCaptionSegments(words: TranscriptWord[]): CaptionSegment[] {
  const groups: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => { if (cur.length) { groups.push(cur); cur = []; } };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.6) flush();
    cur.push(w);
    const dur = cur[cur.length - 1].end - cur[0].start;
    const endsClause = /[.!?,;:]$/.test(w.word);
    if (cur.length >= 5 || dur >= 2.6 || (endsClause && cur.length >= 2)) flush();
  }
  flush();
  return groups.map((g, idx) => ({
    id: 'seg-' + idx,
    start: round2(g[0].start),
    end: round2(Math.max(g[g.length - 1].end + 0.08, g[0].start + 0.4)),
    text: g.map((w) => w.word).join(' '),
    words: g.map((w) => ({ t: w.word, s: round2(w.start), e: round2(w.end) })),
    enabled: true,
  }));
}

/** Re-time a hand-edited caption: distribute the new words evenly across the segment. */
export function retimeSegmentText(seg: CaptionSegment, newText: string): CaptionSegment {
  const parts = newText.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { ...seg, text: '', words: [], enabled: false };
  const span = Math.max(0.2, seg.end - seg.start);
  const per = span / parts.length;
  const words: CaptionWord[] = parts.map((t, i) => ({
    t,
    s: round2(seg.start + i * per),
    e: round2(seg.start + (i + 1) * per),
  }));
  return { ...seg, text: parts.join(' '), words };
}

// ---------------------------------------------------------------------------
// 3. Enhancement plan — claude-sonnet-5 via the Anthropic proxy
// ---------------------------------------------------------------------------

async function askClaude(prompt: string, maxTokens = 3000): Promise<string> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data?.error?.message as string) || ('AI request failed (HTTP ' + res.status + ').'));
  }
  return Array.isArray(data?.content) ? data.content.map((b: any) => b?.text || '').join('') : '';
}

function parseJsonBlock(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('The AI plan came back in an unexpected format.');
  return JSON.parse(cleaned.slice(first, last + 1));
}

export interface EnhancementPlan {
  emphasis: string[];
  graphics: GraphicCue[];
  broll: BrollSlot[];
}

/**
 * One claude-sonnet-5 pass over the transcript: pick emphasis words for the
 * captions, propose HyperFrames-style motion-graphic keyword pops, and suggest
 * optional Veo B-roll moments with cinematic prompts.
 */
export async function planEnhancements(
  transcript: string,
  segments: CaptionSegment[],
  videoDuration: number,
): Promise<EnhancementPlan> {
  const segLines = segments
    .slice(0, 160)
    .map((s) => s.start.toFixed(1) + '-' + s.end.toFixed(1) + 's: ' + s.text)
    .join('\n');
  const prompt = [
    'You are the enhancement director for an AI video editor. A creator uploaded a ' + Math.round(videoDuration) + '-second video. Its word-timed transcript is broken into caption segments below.',
    '',
    'TRANSCRIPT:',
    transcript.slice(0, 6000),
    '',
    'CAPTION SEGMENTS (start-end: text):',
    segLines,
    '',
    'Return ONLY a JSON object, no prose, exactly this shape:',
    '{"emphasis": ["word", ...], "graphics": [{"at": seconds, "duration": seconds, "text": "...", "kind": "keyword"}], "broll": [{"at": seconds, "duration": seconds, "prompt": "..."}]}',
    '',
    'Rules:',
    '- "emphasis": 5 to 12 single words copied verbatim from the transcript — the punchiest, most meaning-carrying words. No duplicates.',
    '- "graphics": 2 to 6 motion-graphic cues. "kind" is "title" (the boldest card, use at most once, near the start) or "keyword" (short punchy pop of 1-3 words). "text" max 24 characters. duration 1.5 to 3 seconds. Place each "at" inside the video and aligned with when the words are spoken. Graphics render in the LOWER portion of the frame (bottom band, alternating bottom-left / bottom-center / bottom-right) and never obscure the center of the image.',
    '- "broll": 0 to 4 cutaway moments where different footage would strengthen the story. Never inside the first 3 seconds. duration 3 to 6 seconds, non-overlapping, at least 8 seconds apart. "prompt" is a vivid cinematic shot description (subject, setting, camera move, lighting) matched to what is being said at that moment. Never include on-screen text, captions, logos, or real people in a prompt.',
    '- All times in seconds within 0 and ' + Math.floor(videoDuration) + '.',
  ].join('\n');

  const raw = await askClaude(prompt, 3000);
  const parsed = parseJsonBlock(raw);

  const emphasis: string[] = Array.isArray(parsed.emphasis)
    ? parsed.emphasis.filter((w: any) => typeof w === 'string' && w.trim()).map((w: string) => w.trim()).slice(0, 14)
    : [];

  const clampAt = (n: any, fallback: number) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), Math.max(0, videoDuration - 1)) : fallback;
  };

  const graphics: GraphicCue[] = (Array.isArray(parsed.graphics) ? parsed.graphics : [])
    .filter((g: any) => g && typeof g.text === 'string' && g.text.trim())
    .slice(0, 6)
    .map((g: any, i: number) => ({
      id: 'gfx-' + i,
      at: round2(clampAt(g.at, i * 5)),
      duration: round2(Math.min(Math.max(Number(g.duration) || 2, 1), 3.5)),
      text: String(g.text).trim().slice(0, 28),
      kind: g.kind === 'title' ? 'title' as const : 'keyword' as const,
      enabled: true,
    }));

  const broll: BrollSlot[] = (Array.isArray(parsed.broll) ? parsed.broll : [])
    .filter((b: any) => b && typeof b.prompt === 'string' && b.prompt.trim())
    .slice(0, 4)
    .map((b: any, i: number) => ({
      id: 'broll-' + i,
      at: round2(Math.max(3, clampAt(b.at, 5 + i * 10))),
      duration: round2(Math.min(Math.max(Number(b.duration) || 4, 3), 6)),
      prompt: String(b.prompt).trim().slice(0, 900),
      enabled: false, // B-roll is optional — the creator opts in per moment
      status: 'idle' as const,
      operationId: null,
      videoUrl: null,
      error: null,
    }));

  return { emphasis, graphics, broll };
}

/** Heuristic fallback when the AI plan fails: emphasize the longest rare words. */
export function fallbackEmphasis(words: TranscriptWord[]): string[] {
  const seen = new Map<string, number>();
  for (const w of words) {
    const clean = w.word.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
    if (clean.length >= 6) seen.set(clean, (seen.get(clean) || 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, 8)
    .map(([w]) => w);
}

/** Mark emphasis words on caption segments (returns copies, does not mutate). */
export function applyEmphasis(segments: CaptionSegment[], emphasis: string[]): CaptionSegment[] {
  const set = new Set(emphasis.map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase()).filter(Boolean));
  return segments.map((seg) => ({
    ...seg,
    words: seg.words.map((w) => {
      const clean = w.t.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
      return set.has(clean) ? { ...w, em: true } : { ...w, em: false };
    }),
  }));
}

// ---------------------------------------------------------------------------
// 4. Veo B-roll generation
// ---------------------------------------------------------------------------

export async function submitBroll(prompt: string, aspectRatio: '16:9' | '9:16', durationSec: number): Promise<string> {
  const res = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      model: 'veo-3.1-fast-generate-preview',
      prompt,
      aspectRatio,
      duration: Math.min(8, Math.max(4, Math.round(durationSec))),
      generateAudio: false,
      resolution: '1080p',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.operationId) {
    const detail = Array.isArray(data?.details) ? data.details.map((d: any) => d?.message).filter(Boolean).join('; ') : '';
    throw new Error((detail || (data?.error as string)) || ('B-roll generation failed to start (HTTP ' + res.status + ').'));
  }
  return String(data.operationId);
}

export async function checkBroll(operationId: string): Promise<{ status: 'processing' | 'completed' | 'failed'; progress?: number; videoUrl?: string; errorMessage?: string }> {
  const enc = encodeURIComponent(operationId);
  const headers = { 'X-Workspace-DB-Token': workspaceToken() };
  let res = await fetch('/api/veo/status/' + enc, { headers });
  if (res.status === 404) {
    res = await fetch('/api/generate/video/status/' + enc, { headers });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error('Could not check B-roll status (HTTP ' + res.status + ').');
  const status = data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : 'processing';
  return { status, progress: Number(data.progress) || 0, videoUrl: data.videoUrl || undefined, errorMessage: data.errorMessage || undefined };
}

// ---------------------------------------------------------------------------
// 4b. Clip / trim (video-clip integration — server-side ffmpeg, durable MP4)
// ---------------------------------------------------------------------------

export async function clipVideo(videoUrlOrKey: string, startSec: number, endSec: number): Promise<{ url: string; durationSec: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = workspaceToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  const res = await fetch('/api/video/clip', {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoUrlOrKey, startSec, endSec, workspaceId: WORKSPACE_UUID }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.url) {
    throw new Error((data?.error as string) || ('Clip failed (HTTP ' + res.status + ').'));
  }
  return { url: String(data.url), durationSec: Number(data.durationSec) || Math.max(0, endSec - startSec) };
}

// ---------------------------------------------------------------------------
// 5. Export — Remotion server-side render
// ---------------------------------------------------------------------------

export interface RenderCaption { start: number; end: number; words: CaptionWord[] }
export interface RenderGraphic { at: number; duration: number; text: string; kind: string }
export interface RenderBroll { at: number; duration: number; url: string }

export interface RenderProps {
  srcUrl: string;
  accent: string;
  captionPreset: CaptionPresetId;
  effect: { filter: string; vignette: boolean; grain: boolean; punchIn: boolean };
  captions: RenderCaption[];
  graphics: RenderGraphic[];
  broll: RenderBroll[];
}

export async function submitRender(props: RenderProps, durationInFrames: number): Promise<string> {
  const res = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      workspaceId: WORKSPACE_UUID,
      compositionTsx: ENHANCER_COMPOSITION_TSX,
      props,
      durationInFrames,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.operationId) {
    throw new Error((data?.error as string) || ('Render submission failed (HTTP ' + res.status + ').'));
  }
  return String(data.operationId);
}

export async function checkRender(operationId: string): Promise<{ status: 'pending' | 'rendering' | 'complete' | 'failed'; videoUrl?: string; error?: string }> {
  const res = await fetch('/api/render/remotion/' + encodeURIComponent(operationId), {
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error('Could not check render status (HTTP ' + res.status + ').');
  return { status: data.status, videoUrl: data.videoUrl || undefined, error: data.error || undefined };
}

/**
 * The export composition. Renders the source video full-frame (contain, on
 * black), timed B-roll cutaways with fades, the HyperFrames-style caption
 * layer with word-accurate karaoke timing and emphasis, keyword/title motion
 * graphics, and the visual-effects grade (filter, vignette, film grain,
 * slow punch-in). Fixed platform geometry: 1920x1080 @ 30fps.
 */
export const ENHANCER_COMPOSITION_TSX = `
import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

const GRAIN_BG = 'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27240%27><filter id=%27n%27><feTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%272%27 stitchTiles=%27stitch%27/></filter><rect width=%27240%27 height=%27240%27 filter=%27url(%23n)%27/></svg>")';

function CaptionLine({ seg, t, preset, accent }) {
  const words = seg.words || [];
  const isBold = preset === 'boldpop';
  const isNeon = preset === 'neon';
  const isKaraoke = preset === 'karaoke';
  const isClean = preset === 'clean';
  const containerStyle = {
    maxWidth: '82%',
    textAlign: 'center',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    lineHeight: 1.18,
  };
  if (isClean) {
    Object.assign(containerStyle, { background: 'rgba(10,15,30,0.72)', borderRadius: 18, padding: '14px 30px', fontSize: 44, fontWeight: 600, color: '#F8FAFC' });
  } else if (isBold) {
    Object.assign(containerStyle, { fontSize: 62, fontWeight: 900, textTransform: 'uppercase', color: '#FFFFFF', WebkitTextStroke: '2.5px rgba(0,0,0,0.85)', textShadow: '0 6px 24px rgba(0,0,0,0.55)' });
  } else if (isKaraoke) {
    Object.assign(containerStyle, { fontSize: 50, fontWeight: 800, color: 'rgba(255,255,255,0.92)', textShadow: '0 4px 18px rgba(0,0,0,0.6)' });
  } else if (isNeon) {
    Object.assign(containerStyle, { fontSize: 54, fontWeight: 800, color: '#FFFFFF' });
  }
  return (
    <div style={containerStyle}>
      {words.map((w, i) => {
        const spoken = t >= w.s;
        const activeNow = t >= w.s && t <= w.e + 0.05;
        const style = { display: 'inline-block', margin: '0 0.14em' };
        if (w.em) style.color = accent;
        if (isBold && activeNow) { style.transform = 'scale(1.12)'; style.color = w.em ? accent : '#FFD84D'; }
        if (isKaraoke) { style.color = spoken ? accent : 'rgba(255,255,255,0.55)'; }
        if (isNeon) {
          style.textShadow = spoken ? ('0 0 18px ' + accent + ', 0 0 42px ' + accent) : '0 2px 12px rgba(0,0,0,0.7)';
          if (activeNow) style.color = accent;
        }
        return <span key={i} style={style}>{w.t}</span>;
      })}
    </div>
  );
}

function BrollClip({ url, dur, filter }) {
  const frame = useCurrentFrame();
  const src = typeof url === 'string' ? url : '';
  const fade = 8;
  const opacity = interpolate(frame, [0, fade, Math.max(fade + 1, dur - fade), dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity, background: '#000' }}>
      {src.length > 0 ? <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter }} /> : null}
    </AbsoluteFill>
  );
}

function GraphicPop({ text, kind, accent, dur }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 160 } });
  const out = interpolate(frame, [Math.max(1, dur - 8), dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const isTitle = kind === 'title';
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: isTitle ? 'center' : 'flex-start', paddingTop: isTitle ? 0 : 110, pointerEvents: 'none' }}>
      <div style={{
        transform: 'scale(' + (0.7 + 0.3 * s) + ') rotate(' + ((1 - s) * -3) + 'deg)',
        opacity: Math.min(s, out),
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        fontWeight: 900,
        textTransform: 'uppercase',
        fontSize: isTitle ? 92 : 56,
        letterSpacing: 2,
        color: '#FFFFFF',
        textShadow: '0 8px 32px rgba(0,0,0,0.6)',
        background: isTitle ? 'transparent' : accent,
        padding: isTitle ? 0 : '10px 26px',
        borderRadius: 14,
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
}

export default function Composition(props) {
  // The render service probes this bundle before the real render, with no
  // inputProps — every prop (including srcUrl) can be absent then, so nothing
  // here may throw on an empty props object.
  const { srcUrl, effect, captionPreset, accent, captions, graphics, broll } = props || {};
  const src = typeof srcUrl === 'string' ? srcUrl : '';
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const filter = (effect && effect.filter) || 'none';
  const scale = effect && effect.punchIn ? interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.06]) : 1;
  const activeCaption = (captions || []).find((c) => t >= c.start && t < c.end) || null;
  const grainShift = (frame % 6) * 17;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {src.length > 0 ? (
          <OffthreadVideo src={src} style={{ width: '100%', height: '100%', objectFit: 'contain', filter, transform: 'scale(' + scale + ')' }} />
        ) : null}
      </AbsoluteFill>

      {(broll || []).map((b, i) => {
        if (!b || typeof b.url !== 'string' || !b.url) return null;
        const from = Math.round(b.at * fps);
        const dur = Math.max(1, Math.round(b.duration * fps));
        return (
          <Sequence key={'broll-' + i} from={from} durationInFrames={dur}>
            <BrollClip url={b.url} dur={dur} filter={filter} />
          </Sequence>
        );
      })}

      {effect && effect.vignette ? (
        <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(0,0,0,0.42) 100%)' }} />
      ) : null}
      {effect && effect.grain ? (
        <AbsoluteFill style={{ pointerEvents: 'none', opacity: 0.07, backgroundImage: GRAIN_BG, backgroundPosition: grainShift + 'px ' + grainShift + 'px' }} />
      ) : null}

      {(graphics || []).map((g, i) => {
        const from = Math.round(g.at * fps);
        const dur = Math.max(1, Math.round(g.duration * fps));
        return (
          <Sequence key={'gfx-' + i} from={from} durationInFrames={dur}>
            <GraphicPop text={g.text} kind={g.kind} accent={accent || '#3B82F6'} dur={dur} />
          </Sequence>
        );
      })}

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 84 }}>
        {activeCaption ? <CaptionLine seg={activeCaption} t={t} preset={captionPreset || 'boldpop'} accent={accent || '#3B82F6'} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
`;

