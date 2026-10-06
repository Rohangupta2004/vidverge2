/**
 * Short Video Enhancer — the only talk-to-server layer.
 *
 * Platform surfaces used, all documented integrations:
 *   file-storage              POST /api/upload/file  (+ signed route over 50MB)
 *   deepgram-transcription    POST /api/workspaces/:id/audio/transcribe-timestamped
 *   openai-text-generation    POST /proxy/openai/v1/chat/completions
 *   gemini-vision-transform   POST /api/generate/vision
 *   server-functions          POST /api/hooks/execute/:workspaceId/{sve-render,sve-sfx-library}
 *   workspace-db              window.__workspaceDb (svenhancer_projects / _assets)
 *
 * Every proxy call carries the visitor's workspace token; anonymous calls are
 * refused by the platform before a provider is contacted.
 */

import {
  SVE_WORKSPACE_ID, hydrateProject,
  type IconId, type InsertKind, type Project, type TranscriptWord,
} from './model';
import { SVE_COMPOSITION_TSX } from './composition';

export const PROJECT_TABLE = 'svenhancer_projects';
export const ASSET_TABLE = 'svenhancer_assets';
export const RENDER_HOOK = 'sve-render';
export const SFX_LIBRARY_HOOK = 'sve-sfx-library';

export const BUFFERED_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function wdb(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

export function workspaceToken(): string {
  return String(wdb()?.token || '');
}

function appId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || '');
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadResult { url: string; bytes: number }

async function uploadBuffered(file: File, folder: string): Promise<UploadResult> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('workspaceId', SVE_WORKSPACE_ID);
  form.append('folder', folder);
  const headers: Record<string, string> = { 'X-Workspace-DB-Token': token };
  const id = appId();
  if (id) headers['X-App-Id'] = id;
  const res = await fetch('/api/upload/file', { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || 'Upload failed (HTTP ' + res.status + ').'));
  return { url: String(data.url), bytes: Number(data.bytes) || file.size };
}

async function uploadSigned(file: File): Promise<UploadResult> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const contentType = file.type || 'video/mp4';
  const grantRes = await fetch('/api/upload/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ size: file.size, contentType }),
  });
  const grant = await grantRes.json().catch(() => null);
  if (!grantRes.ok || !grant?.uploadUrl) {
    throw new Error(
      'Files over 50 MB need the platform\u2019s large-upload channel, which answered HTTP ' + grantRes.status +
      '. Trim or compress the clip to under 50 MB and try again.',
    );
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
  return { url: String(grant.uploadUrl).split('?')[0], bytes: file.size };
}

export async function uploadAsset(file: File, folder = 'short-video-enhancer'): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That file is larger than the 500 MB limit.');
  if (file.size <= BUFFERED_UPLOAD_BYTES) return uploadBuffered(file, folder);
  return uploadSigned(file);
}

// ---------------------------------------------------------------------------
// Transcription — word timestamps drive caption timing
// ---------------------------------------------------------------------------

export interface TranscriptResult { words: TranscriptWord[]; text: string; duration: number; note: string }

async function postTimestamped(blob: Blob, filename: string): Promise<TranscriptResult> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const form = new FormData();
  form.append('audio', blob, filename);
  const res = await fetch('/api/workspaces/' + SVE_WORKSPACE_ID + '/audio/transcribe-timestamped', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(String(data?.error || 'Transcription failed (HTTP ' + res.status + ').'));
  const words: TranscriptWord[] = Array.isArray(data.words)
    ? data.words
        .filter((w: any) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
        .map((w: any) => ({ word: String(w.word), start: Number(w.start), end: Number(w.end) }))
    : [];
  return { words, text: String(data.transcript || ''), duration: Number(data.duration) || 0, note: '' };
}

/** 16 kHz mono WAV of a media file's audio track, decoded in the browser. */
async function extractWav(file: File): Promise<Blob> {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error('This browser cannot decode audio locally.');
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
  } finally {
    try { await ctx.close(); } catch { /* no-op */ }
  }
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const samples = rendered.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Word-level transcript of the footage. The video container is tried first;
 * if the service refuses it, the audio track is extracted locally and retried.
 * A failure is never fatal — the caption engine distributes words evenly when
 * there are no timestamps, and the note says so.
 */
export async function transcribeClip(file: File): Promise<TranscriptResult> {
  try {
    return await postTimestamped(file, file.name || 'clip.mp4');
  } catch (first) {
    try {
      const wav = await extractWav(file);
      const out = await postTimestamped(wav, 'audio.wav');
      return { ...out, note: 'The video container was refused, so the audio track was extracted locally and transcribed.' };
    } catch (second) {
      return {
        words: [],
        text: '',
        duration: 0,
        note: 'No transcript available (' + msg(first) + ' / ' + msg(second) + '). Captions can still be typed by hand.',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// AI emphasis pass (openai-text-generation)
// ---------------------------------------------------------------------------

export interface EmphasisSuggestion { words: string[]; headline: string; note: string }

/**
 * Ask the text model which words carry the beat. Purely additive: the local
 * heuristic already works, this just sharpens it. A failure returns an empty
 * suggestion instead of throwing.
 */
export async function suggestEmphasis(transcript: string): Promise<EmphasisSuggestion> {
  const token = workspaceToken();
  const text = transcript.trim().slice(0, 4000);
  if (!token || !text) return { words: [], headline: '', note: 'No transcript to read.' };
  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        reasoning_effort: 'none',
        max_completion_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'You are a short-form motion designer. Given a spoken transcript, return STRICT JSON only: ' +
              '{"emphasis":["word",...],"headline":"short on-screen headline"}. ' +
              'Pick at most 10 single words that deserve an oversized or highlighted caption treatment — the words a viewer must not miss. ' +
              'Use words that appear verbatim in the transcript. No commentary.',
          },
          { role: 'user', content: text },
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { words: [], headline: '', note: 'The text model answered HTTP ' + res.status + '.' };
    const raw = String(data?.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { words: [], headline: '', note: 'The text model did not return JSON.' };
    const parsed = JSON.parse(match[0]);
    return {
      words: Array.isArray(parsed.emphasis) ? parsed.emphasis.map((w: unknown) => String(w)).slice(0, 10) : [],
      headline: String(parsed.headline || '').slice(0, 60),
      note: '',
    };
  } catch (e) {
    return { words: [], headline: '', note: msg(e) };
  }
}

// ---------------------------------------------------------------------------
// Concept extraction for visual inserts (openai-text-generation)
// ---------------------------------------------------------------------------

/** One concrete thing the script mentions that can carry a visual. */
export interface ConceptHit {
  phrase: string;
  concept: string;
  kind: InsertKind;
  label: string;
  icon: IconId;
}

export interface ConceptResult { concepts: ConceptHit[]; note: string }

const INSERT_KIND_IDS: InsertKind[] = ['product', 'data', 'process', 'concept'];
const ICON_IDS: IconId[] = ['spark', 'bulb', 'gear', 'check', 'bolt', 'chart', 'lock', 'cloud', 'target', 'rocket'];

/**
 * Pull the concrete nouns and action phrases out of the transcript and say what
 * KIND of visual each one wants. The local heuristic in lib/inserts.ts already
 * produces a usable list, so a failure here is never fatal — it returns an
 * empty result and the note explains why.
 */
export async function extractInsertConcepts(transcript: string): Promise<ConceptResult> {
  const token = workspaceToken();
  const text = transcript.trim().slice(0, 4000);
  if (!token) return { concepts: [], note: 'Your workspace session is still loading.' };
  if (!text) return { concepts: [], note: 'No transcript to read.' };
  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        reasoning_effort: 'none',
        max_completion_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
              'You are a short-form motion designer planning B-roll inserts. Read the spoken transcript and return STRICT JSON only: ' +
              '{"inserts":[{"phrase":"verbatim phrase from the transcript","concept":"2-5 word description of what it is",' +
              '"kind":"product|data|process|concept","label":"on-screen text, max 28 chars","icon":"spark|bulb|gear|check|bolt|chart|lock|cloud|target|rocket"}]}. ' +
              'Rules: kind=product for a named app, tool, SaaS or product; kind=data for a number, percentage, metric or money figure ' +
              '(put the figure itself in label, optionally as "3.4x|conversion lift"); kind=process for a workflow or sequence of steps ' +
              '(label as pipe-separated steps, e.g. "Brief|Draft|Ship"); kind=concept for an abstract idea. ' +
              'At most 8 inserts, each phrase must appear verbatim in the transcript, no commentary.',
          },
          { role: 'user', content: text },
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { concepts: [], note: 'The text model answered HTTP ' + res.status + '.' };
    const raw = String(data?.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { concepts: [], note: 'The text model did not return JSON.' };
    const parsed = JSON.parse(match[0]);
    const list = Array.isArray(parsed?.inserts) ? parsed.inserts : [];
    const concepts: ConceptHit[] = list
      .filter((r: any) => r && typeof r.phrase === 'string' && r.phrase.trim())
      .slice(0, 8)
      .map((r: any) => ({
        phrase: String(r.phrase).trim().slice(0, 120),
        concept: String(r.concept || r.phrase).trim().slice(0, 60),
        kind: INSERT_KIND_IDS.indexOf(r.kind) >= 0 ? (r.kind as InsertKind) : 'concept',
        label: String(r.label || r.concept || '').trim().slice(0, 48),
        icon: ICON_IDS.indexOf(r.icon) >= 0 ? (r.icon as IconId) : 'spark',
      }));
    return { concepts, note: concepts.length ? '' : 'The text model found nothing concrete to illustrate.' };
  } catch (e) {
    return { concepts: [], note: msg(e) };
  }
}

// ---------------------------------------------------------------------------
// Subject detection (gemini-vision-transform)
// ---------------------------------------------------------------------------

export interface VisionBox { found: boolean; x: number; y: number; w: number; h: number; label: string; note: string }

function clamp01(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fb;
}

/**
 * Ask the vision model where the presenter / product is in ONE sampled frame,
 * as a normalised bounding box. The depth composite builds its mask from these
 * boxes; when the model is unavailable the caller falls back to the local face
 * and saliency tracker, which is why a failure here only returns `found: false`.
 */
export async function locateSubject(imageBase64: string, mimeType = 'image/jpeg'): Promise<VisionBox> {
  const empty: VisionBox = { found: false, x: 0.5, y: 0.56, w: 0.64, h: 0.9, label: '', note: '' };
  if (!imageBase64) return { ...empty, note: 'No frame to analyse.' };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = workspaceToken();
    if (token) headers['X-Workspace-DB-Token'] = token;
    const id = appId();
    if (id) headers['X-App-Id'] = id;
    const res = await fetch('/api/generate/vision', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: imageBase64,
        mimeType,
        prompt:
          'Locate the single main subject of this video frame \u2014 the person, character or product in focus. ' +
          'Answer with STRICT JSON only, no prose and no code fence: ' +
          '{"found":true,"x":0.5,"y":0.55,"w":0.6,"h":0.9,"label":"person"}. ' +
          'x and y are the CENTRE of the subject as fractions of the image width and height; ' +
          'w and h are the subject\u2019s width and height as fractions of the image. ' +
          'If there is no clear single subject answer {"found":false}.',
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return { ...empty, note: String(data?.error || 'The vision model answered HTTP ' + res.status + '.') };
    }
    const match = String(data.result || '').match(/\{[\s\S]*\}/);
    if (!match) return { ...empty, note: 'The vision model did not return JSON.' };
    const parsed = JSON.parse(match[0]);
    if (!parsed || parsed.found === false) return { ...empty, note: 'No clear single subject in this frame.' };
    return {
      found: true,
      x: clamp01(parsed.x, 0.5),
      y: clamp01(parsed.y, 0.56),
      w: Math.min(1, Math.max(0.1, Number(parsed.w) || 0.64)),
      h: Math.min(1, Math.max(0.1, Number(parsed.h) || 0.9)),
      label: String(parsed.label || 'subject').slice(0, 40),
      note: '',
    };
  } catch (e) {
    return { ...empty, note: msg(e) };
  }
}

// ---------------------------------------------------------------------------
// Server function + render
// ---------------------------------------------------------------------------

export async function executeHook<T = Record<string, unknown>>(name: string, body: Record<string, unknown>, timeoutMs = 290000): Promise<T> {
  const controller = new AbortController();
  const giveUp = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/hooks/execute/' + SVE_WORKSPACE_ID + '/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, wt: workspaceToken() }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(String((data && (data.error || data.message)) || 'The ' + name + ' service answered HTTP ' + res.status + '.'));
    return (data || {}) as T;
  } finally {
    window.clearTimeout(giveUp);
  }
}

export interface RenderAnswer {
  status: 'complete' | 'rendering' | 'failed';
  renderUrl?: string;
  operationId?: string;
  geometry?: string;
  error?: string;
  note?: string;
}

/**
 * Submit the composition for a 1080x1920 master. The server function owns the
 * submit, the poll and the portrait finish, so closing the tab cannot strand a
 * render — re-call with the returned operationId to keep waiting.
 */
export async function submitRender(props: unknown, durationInFrames: number): Promise<RenderAnswer> {
  return executeHook<RenderAnswer>(RENDER_HOOK, {
    compositionTsx: SVE_COMPOSITION_TSX,
    props,
    durationInFrames: Math.max(30, Math.round(durationInFrames)),
  });
}

export async function continueRender(operationId: string): Promise<RenderAnswer> {
  return executeHook<RenderAnswer>(RENDER_HOOK, { operationId });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: number;
  title?: string | null;
  preset?: string | null;
  status?: string | null;
  duration_s?: number | string | null;
  frames?: number | null;
  source_url?: string | null;
  doc?: unknown;
  render_url?: string | null;
  render_operation_id?: string | null;
  render_geometry?: string | null;
  render_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Read a stored project document. Everything a newer engine expects but an
 * older document never had is filled in by `hydrateProject`, so reopening a
 * Phase 1 / Phase 2 project lands in a fully formed Phase 4 editor.
 */
export function parseDoc(row: ProjectRow): Project | null {
  let doc: unknown = row.doc;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { return null; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  return hydrateProject(doc as Partial<Project>);
}

export async function listProjects(limit = 24): Promise<ProjectRow[]> {
  const client = wdb();
  if (!client?.from) return [];
  try {
    const res = await client.from(PROJECT_TABLE).orderBy('updated_at', 'desc').limit(limit).get();
    return Array.isArray(res?.data) ? (res.data as ProjectRow[]) : [];
  } catch (e) {
    console.warn('[ShortVideoEnhancer] could not read projects:', e);
    return [];
  }
}

export async function insertProject(fields: Record<string, unknown>): Promise<number | null> {
  const client = wdb();
  if (!client?.from) return null;
  try {
    const res = await client.from(PROJECT_TABLE).insert(fields);
    const row = res?.data ? (Array.isArray(res.data) ? res.data[0] : res.data) : res;
    const id = row?.id != null ? Number(row.id) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (e) {
    console.warn('[ShortVideoEnhancer] could not create the project row:', e);
    return null;
  }
}

export async function updateProject(id: number | null, patch: Record<string, unknown>): Promise<boolean> {
  if (!id) return false;
  const client = wdb();
  if (!client?.from) return false;
  try {
    await client.from(PROJECT_TABLE).update(id, patch);
    return true;
  } catch (e) {
    console.warn('[ShortVideoEnhancer] could not update the project row:', e);
    return false;
  }
}

export async function recordAsset(fields: Record<string, unknown>): Promise<void> {
  const client = wdb();
  if (!client?.from) return;
  try {
    await client.from(ASSET_TABLE).insert(fields);
  } catch (e) {
    console.warn('[ShortVideoEnhancer] could not record the asset:', e);
  }
}

/**
 * Ask the server-owned registry to adopt a deterministic SFX upload. The
 * server validates the effect id and WAV bytes, writes a session-less row, and
 * returns the canonical URL (which may already have won a first-use race).
 */
export async function recordSharedSfxAsset(fields: {
  label: string;
  url: string;
  bytes: number;
  duration_s: number;
}): Promise<string | null> {
  const answer = await executeHook<{ success?: boolean; url?: string }>(SFX_LIBRARY_HOOK, {
    op: 'register',
    effectId: fields.label,
    url: fields.url,
    bytes: fields.bytes,
    duration: fields.duration_s,
  });
  const url = String(answer?.url || '');
  return answer?.success && url.startsWith('https://') ? url : null;
}

/**
 * The stored URL of a previously recorded asset, or null when there is none.
 *
 * SFX lookups first ask the server-owned, workspace-wide registry. If that
 * route is unavailable, the normal session-owned query remains as a local
 * fallback, and the caller can still render a byte-identical replacement.
 */
export async function findAsset(kind: string, label: string): Promise<string | null> {
  if (kind === 'sfx-library') {
    try {
      const answer = await executeHook<{ success?: boolean; found?: boolean; url?: string }>(SFX_LIBRARY_HOOK, {
        op: 'lookup',
        effectId: label,
      });
      const sharedUrl = String(answer?.url || '');
      if (answer?.success && answer?.found && sharedUrl.startsWith('https://')) return sharedUrl;
    } catch (e) {
      console.warn('[ShortVideoEnhancer] shared SFX lookup failed; using the local cache:', e);
    }
  }

  const client = wdb();
  if (!client?.from) return null;
  try {
    const res = await client.from(ASSET_TABLE)
      .where('kind', kind)
      .where('label', label)
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();
    const rows = Array.isArray(res?.data) ? res.data : [];
    const url = rows.length ? String(rows[0]?.url || '') : '';
    return url.startsWith('http') ? url : null;
  } catch (e) {
    console.warn('[ShortVideoEnhancer] could not look up the asset:', e);
    return null;
  }
}
