/**
 * Short Video Enhancer — Phase 2 talk-to-server layer.
 *
 * Every platform surface the editor touches, in one place, each one a
 * documented integration:
 *
 *   file-storage              POST /api/upload/file  (+ signed route over 50MB)
 *   deepgram-transcription    POST /api/workspaces/:id/audio/transcribe-timestamped
 *   openai-text-generation    POST /proxy/openai/v1/chat/completions
 *   gemini-vision-transform   POST /api/generate/vision
 *   elevenlabs-audio          POST /api/workspaces/:id/audio/music/custom
 *   custom-api-keys           POST /api/workspaces/:id/secrets/proxy   (Pexels)
 *   server-functions          POST /api/hooks/execute/:id/{sve-render,sve-share-encode}
 *   workspace-db              window.__workspaceDb (svenhancer_projects / _assets)
 *
 * Two rules hold throughout:
 *   1. Every proxy call carries the visitor's workspace token. Anonymous calls
 *      are refused by the platform before a provider is contacted.
 *   2. Nothing here throws a generic message. A caller that fails tells the
 *      creator WHICH step failed and what to do, because "Something went wrong"
 *      is not an error message.
 */

import { type CaptionWord, type EditDoc, type VisionRead, hydrateDoc } from './sveTypes';
import { SVE_PHASE2_COMPOSITION } from './sveComposition';
import {
  WORKSPACE_ID,
  callHook as callWorkspaceHook,
  spaceId,
  workspaceTokenNow,
} from '../../../lib/workspace';

export const PROJECT_TABLE = 'svenhancer_projects';
export const ASSET_TABLE = 'svenhancer_assets';
export const RENDER_HOOK = 'sve-render';
export const SHARE_HOOK = 'sve-share-encode';

const BUFFERED_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function wdb(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

export const workspaceToken = workspaceTokenNow;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function requireToken(step: string): string {
  const token = workspaceToken();
  if (!token) {
    throw new Error(step + ' needs your workspace session, which is still loading. Wait a second and try again.');
  }
  return token;
}

// ---------------------------------------------------------------------------
// Upload — the source clip must be a durable URL before anything can render it
// ---------------------------------------------------------------------------

export interface UploadResult { url: string; bytes: number }

async function uploadBuffered(file: File, folder: string): Promise<UploadResult> {
  const token = requireToken('Uploading your video');
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('workspaceId', WORKSPACE_ID);
  form.append('folder', folder);
  const headers: Record<string, string> = { 'X-Workspace-DB-Token': token };
  const id = spaceId();
  if (id) headers['X-App-Id'] = id;
  const res = await fetch('/api/upload/file', { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new Error('Upload failed — ' + String(data?.error || 'the storage service answered HTTP ' + res.status) + '. Try re-uploading the clip.');
  }
  return { url: String(data.url), bytes: Number(data.bytes) || file.size };
}

async function uploadSigned(file: File): Promise<UploadResult> {
  const token = requireToken('Uploading your video');
  const contentType = file.type || 'video/mp4';
  const grantRes = await fetch('/api/upload/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ size: file.size, contentType }),
  });
  const grant = await grantRes.json().catch(() => null);
  if (!grantRes.ok || !grant?.uploadUrl) {
    throw new Error(
      'Files over 50 MB use the large-upload channel, which answered HTTP ' + grantRes.status +
      '. Compress or trim the clip below 50 MB and try again.',
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
  if (!put.ok) throw new Error('The large upload stopped at HTTP ' + put.status + ' — try again on a steadier connection.');
  return { url: String(grant.uploadUrl).split('?')[0], bytes: file.size };
}

export async function uploadAsset(file: File, folder = 'short-video-enhancer'): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That file is ' + (file.size / 1024 / 1024).toFixed(0) + ' MB — over the 500 MB limit. Trim it first.');
  }
  if (file.size <= BUFFERED_UPLOAD_BYTES) return uploadBuffered(file, folder);
  return uploadSigned(file);
}

// ---------------------------------------------------------------------------
// Transcription — word timestamps are what make the captions speech-locked
// ---------------------------------------------------------------------------

export interface TranscriptResult {
  words: CaptionWord[];
  text: string;
  duration: number;
  /** Empty when word timing came back; otherwise says exactly what failed. */
  note: string;
}

async function postTimestamped(blob: Blob, filename: string): Promise<TranscriptResult> {
  const token = requireToken('Caption generation');
  const form = new FormData();
  form.append('audio', blob, filename);
  const res = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/transcribe-timestamped', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(String(data?.error || 'the transcription service answered HTTP ' + res.status));
  }
  const words: CaptionWord[] = Array.isArray(data.words)
    ? data.words
        .filter((w: any) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
        .map((w: any) => ({ text: String(w.word), start: Number(w.start), end: Number(w.end) }))
    : [];
  return { words, text: String(data.transcript || ''), duration: Number(data.duration) || 0, note: '' };
}

/** 16 kHz mono WAV of a media file's audio track, decoded in the browser. */
async function extractWav(file: File): Promise<Blob> {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error('this browser cannot decode audio locally');
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
 * Word-level transcript of the footage. The container is tried first; if the
 * service refuses it the audio track is extracted locally and retried. Failure
 * is never fatal — the caption engine spaces words evenly instead, and `note`
 * says so rather than letting the UI imply the captions are speech-locked.
 */
export async function transcribeClip(file: File): Promise<TranscriptResult> {
  try {
    return await postTimestamped(file, file.name || 'clip.mp4');
  } catch (first) {
    try {
      const wav = await extractWav(file);
      const out = await postTimestamped(wav, 'audio.wav');
      return { ...out, note: '' };
    } catch (second) {
      return {
        words: [],
        text: '',
        duration: 0,
        note: 'Caption timing could not be measured (' + msg(first) + '). Words are spaced evenly instead — ' +
          'type the transcript below and they will re-time, or re-upload the clip if it has no audio track.',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Gemini Vision — what the footage actually shows
// ---------------------------------------------------------------------------

const VISION_PROMPT =
  'You are a short-form video editor reviewing sampled frames from one vertical clip. ' +
  'Answer with STRICT JSON only, no prose and no code fence: ' +
  '{"sceneType":"","objects":[""],"mood":"","palette":["#rrggbb"],"keyMoments":[""],' +
  '"brollTerms":[""],"calloutText":[""],"captionAccent":"#rrggbb"}. ' +
  'sceneType: 2-4 words (e.g. "indoor talking head"). objects: up to 6 concrete things visible. ' +
  'mood: one of energetic, calm, dramatic, upbeat. palette: 3 dominant hex colours. ' +
  'keyMoments: up to 3 short notes about what changes across the frames. ' +
  'brollTerms: up to 5 stock-footage search phrases that would cut well against this clip. ' +
  'calloutText: up to 3 punchy on-screen caption lines, max 28 characters each. ' +
  'captionAccent: a hex colour that will read clearly on top of this footage.';

const EMPTY_VISION: VisionRead = {
  sceneType: '', objects: [], mood: '', palette: [], keyMoments: [],
  brollTerms: [], calloutText: [], captionAccent: '', note: '',
};

function str(v: unknown, max: number): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function strList(v: unknown, max: number, len: number): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : [];
}

/**
 * Read evenly sampled frames with the vision model. One call carries all the
 * frames as a tiled contact sheet, so a five-frame read costs one request
 * instead of five.
 */
export async function readFramesWithVision(contactSheetBase64: string): Promise<VisionRead> {
  if (!contactSheetBase64) return { ...EMPTY_VISION, note: 'No frames could be sampled from this clip.' };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = workspaceToken();
    if (token) headers['X-Workspace-DB-Token'] = token;
    const id = spaceId();
    if (id) headers['X-App-Id'] = id;
    const res = await fetch('/api/generate/vision', {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: contactSheetBase64, mimeType: 'image/jpeg', prompt: VISION_PROMPT }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return { ...EMPTY_VISION, note: 'Scene analysis is unavailable — ' + String(data?.error || 'the vision model answered HTTP ' + res.status) + '.' };
    }
    const match = String(data.result || '').match(/\{[\s\S]*\}/);
    if (!match) return { ...EMPTY_VISION, note: 'The vision model replied in prose instead of JSON. Re-run the analysis.' };
    const p = JSON.parse(match[0]);
    return {
      sceneType: str(p.sceneType, 48),
      objects: strList(p.objects, 6, 32),
      mood: str(p.mood, 24).toLowerCase(),
      palette: strList(p.palette, 3, 9),
      keyMoments: strList(p.keyMoments, 3, 90),
      brollTerms: strList(p.brollTerms, 5, 48),
      calloutText: strList(p.calloutText, 3, 28),
      captionAccent: /^#[0-9a-fA-F]{6}$/.test(str(p.captionAccent, 7)) ? str(p.captionAccent, 7) : '',
      note: '',
    };
  } catch (e) {
    return { ...EMPTY_VISION, note: 'Scene analysis failed — ' + msg(e) + '.' };
  }
}

// ---------------------------------------------------------------------------
// The music agent — footage in, an ElevenLabs prompt out
// ---------------------------------------------------------------------------

export interface MusicBrief { prompt: string; rationale: string; note: string }

/**
 * Turn what we measured about the clip into a music prompt. The model is given
 * the vision read plus the measured loudness/tempo numbers, never asked to
 * guess from a title — which is the whole point of dropping the old preset
 * dropdown.
 */
export async function writeMusicPrompt(input: {
  vision: VisionRead | null;
  bpm: number;
  energy: number;
  durationS: number;
  transcript: string;
}): Promise<MusicBrief> {
  const token = workspaceToken();
  const facts = [
    'Clip length: ' + input.durationS.toFixed(1) + ' seconds.',
    'Measured onset tempo: about ' + Math.round(input.bpm) + ' BPM.',
    'Measured energy (0-1): ' + input.energy.toFixed(2) + '.',
    input.vision?.sceneType ? 'Scene: ' + input.vision.sceneType + '.' : '',
    input.vision?.mood ? 'Visual mood: ' + input.vision.mood + '.' : '',
    input.vision?.objects.length ? 'On screen: ' + input.vision.objects.join(', ') + '.' : '',
    input.transcript ? 'Spoken content: ' + input.transcript.slice(0, 600) : '',
  ].filter(Boolean).join('\n');

  const fallback = localMusicPrompt(input.bpm, input.energy, input.durationS, input.vision);
  if (!token) return { prompt: fallback, rationale: 'Written from the measured tempo and energy.', note: '' };

  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        reasoning_effort: 'none',
        max_completion_tokens: 320,
        messages: [
          {
            role: 'system',
            content:
              'You brief a music generator for short-form video. Given measurements of one clip, return STRICT JSON only: ' +
              '{"prompt":"","rationale":""}. prompt is a single descriptive line for an instrumental bed, 12-28 words, ' +
              'naming genre, tempo in BPM, instrumentation, energy arc and the clip length in seconds, and it must end with ' +
              '"no vocals". rationale is one short sentence saying why that fits the footage. No commentary.',
          },
          { role: 'user', content: facts },
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { prompt: fallback, rationale: '', note: 'The brief was written from measurements — the text model answered HTTP ' + res.status + '.' };
    }
    const match = String(data?.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/);
    if (!match) return { prompt: fallback, rationale: '', note: 'The text model did not return JSON; using the measured brief.' };
    const parsed = JSON.parse(match[0]);
    const prompt = str(parsed.prompt, 400);
    return {
      prompt: prompt.length >= 10 ? prompt : fallback,
      rationale: str(parsed.rationale, 180),
      note: '',
    };
  } catch (e) {
    return { prompt: fallback, rationale: '', note: 'The brief was written from measurements — ' + msg(e) + '.' };
  }
}

/** Deterministic brief, used whenever the text model is unavailable. */
export function localMusicPrompt(bpm: number, energy: number, durationS: number, vision: VisionRead | null): string {
  const tempo = Math.round(Math.max(70, Math.min(160, bpm || 110)));
  const mood = (vision?.mood || (energy > 0.62 ? 'energetic' : energy < 0.3 ? 'calm' : 'upbeat')).toLowerCase();
  const bed =
    mood === 'calm' ? 'warm ambient keys, soft brushed percussion, gentle swell'
    : mood === 'dramatic' ? 'cinematic strings, deep sub hits, rising tension'
    : mood === 'energetic' ? 'punchy electronic drums, driving bass, bright synth stabs'
    : 'upbeat pop-electronic, crisp claps, warm plucked synth';
  return bed + ', ' + tempo + ' BPM, steady groove under dialogue, ' + Math.round(durationS) + ' seconds, no vocals';
}

export interface MusicResult { url: string; durationMs: number; provider: string; prompt: string }

/** ElevenLabs custom music. The bed sits UNDER the original audio, never over it. */
export async function generateMusic(prompt: string, durationS: number): Promise<MusicResult> {
  const token = requireToken('Music generation');
  const clean = String(prompt || '').trim();
  if (clean.length < 10) throw new Error('The music prompt needs at least 10 characters — describe the genre, tempo and mood.');
  const lengthMs = Math.max(3000, Math.min(600000, Math.round((Number(durationS) || 30) * 1000)));
  const res = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/music/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ prompt: clean, lengthMs, instrumental: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data?.audioUrl) {
    const code = String(data?.code || '');
    if (code === 'provider_quota_exceeded') {
      throw new Error('Music generation is out of provider credits right now. Try again later, or upload your own track.');
    }
    if (res.status === 402) {
      throw new Error('Music generation needs workspace wallet balance. Top up the wallet and press Regenerate.');
    }
    throw new Error('Music generation failed — ' + String(data?.error || 'the audio service answered HTTP ' + res.status) + '.');
  }
  return {
    url: String(data.audioUrl),
    durationMs: Number(data.durationMs) || lengthMs,
    provider: String(data.provider || 'elevenlabs'),
    prompt: clean,
  };
}

// ---------------------------------------------------------------------------
// Pexels B-roll, through the secrets proxy. Optional by design.
// ---------------------------------------------------------------------------

export type PexelsVerdict = 'unknown' | 'usable' | 'missing' | 'host-not-allowed' | 'rejected';

export interface PexelsClip { id: string; name: string; url: string; posterUrl: string; durationS: number }
export interface PexelsAnswer { clips: PexelsClip[]; verdict: PexelsVerdict; note: string }

const CONFIG_FAILURES = new Set(['unknown_secret', 'no_allowed_hosts', 'host_not_allowed']);

/** One latch per page load — never one probe per search. */
let pexelsVerdict: PexelsVerdict = 'unknown';

export function pexelsKeyVerdict(): PexelsVerdict {
  return pexelsVerdict;
}

export async function searchPexelsVideos(query: string, perPage = 8): Promise<PexelsAnswer> {
  const term = String(query || '').trim();
  if (!term) return { clips: [], verdict: pexelsVerdict, note: 'Type a search term first.' };
  if (pexelsVerdict !== 'unknown' && pexelsVerdict !== 'usable') {
    return { clips: [], verdict: pexelsVerdict, note: pexelsNote(pexelsVerdict) };
  }
  const token = workspaceToken();
  if (!token) return { clips: [], verdict: 'unknown', note: 'Your workspace session is still loading.' };

  try {
    const res = await fetch('/api/workspaces/' + WORKSPACE_ID + '/secrets/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({
        method: 'GET',
        url: 'https://api.pexels.com/videos/search',
        query: { query: term, per_page: String(Math.max(1, Math.min(15, perPage))), orientation: 'portrait' },
        headers: { Authorization: '{{secrets.PEXELS_API_KEY}}' },
        responseType: 'json',
      }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const code = String(data?.code || '');
      if (CONFIG_FAILURES.has(code)) {
        pexelsVerdict = code === 'unknown_secret' ? 'missing' : 'host-not-allowed';
        return { clips: [], verdict: pexelsVerdict, note: pexelsNote(pexelsVerdict) };
      }
      return { clips: [], verdict: pexelsVerdict, note: 'Stock B-roll search is briefly unavailable (' + (code || 'HTTP ' + res.status) + '). Try again, or upload your own clip.' };
    }

    if (data?.status === 401 || data?.status === 403) {
      pexelsVerdict = 'rejected';
      return { clips: [], verdict: pexelsVerdict, note: pexelsNote(pexelsVerdict) };
    }
    if (Number(data?.status) >= 400) {
      return { clips: [], verdict: pexelsVerdict, note: 'Pexels answered HTTP ' + data.status + ' for “' + term + '”. Try a different search term.' };
    }

    pexelsVerdict = 'usable';
    const videos = Array.isArray(data?.body?.videos) ? data.body.videos : [];
    const clips: PexelsClip[] = videos.map((v: any) => {
      const files = Array.isArray(v?.video_files) ? v.video_files : [];
      // Prefer the smallest file at or above 720p — big enough to look sharp
      // in a corner PiP, small enough that the render fetches it quickly.
      const ranked = files
        .filter((f: any) => f && typeof f.link === 'string' && String(f.file_type || '').indexOf('mp4') > -1)
        .sort((a: any, b: any) => (Number(a.height) || 0) - (Number(b.height) || 0));
      const pick = ranked.find((f: any) => (Number(f.height) || 0) >= 720) || ranked[ranked.length - 1];
      return {
        id: 'pexels-' + String(v?.id || Math.random().toString(36).slice(2)),
        name: str(v?.user?.name ? term + ' · ' + v.user.name : term, 48),
        url: String(pick?.link || ''),
        posterUrl: String(v?.image || ''),
        durationS: Number(v?.duration) || 0,
      };
    }).filter((c: PexelsClip) => c.url.startsWith('http'));

    return {
      clips,
      verdict: 'usable',
      note: clips.length ? '' : 'No portrait stock clips matched “' + term + '”. Try a broader term.',
    };
  } catch (e) {
    return { clips: [], verdict: pexelsVerdict, note: 'Stock B-roll search failed — ' + msg(e) + '. You can still upload your own clip.' };
  }
}

function pexelsNote(v: PexelsVerdict): string {
  if (v === 'missing') return 'No PEXELS_API_KEY is configured for this workspace, so stock search is off. Upload your own B-roll below — everything else works the same.';
  if (v === 'host-not-allowed') return 'PEXELS_API_KEY is not allowed to call api.pexels.com. Add that host to the key in the Integrations panel, or upload your own B-roll.';
  if (v === 'rejected') return 'Pexels rejected PEXELS_API_KEY. Check or rotate the key’s value, or upload your own B-roll.';
  return '';
}

// ---------------------------------------------------------------------------
// Render + export
// ---------------------------------------------------------------------------

async function executeHook<T>(name: string, body: Record<string, unknown>, timeoutMs = 290000): Promise<T> {
  const controller = new AbortController();
  const giveUp = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await callWorkspaceHook<T>(name, body, { signal: controller.signal });
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
    compositionTsx: SVE_PHASE2_COMPOSITION,
    props,
    durationInFrames: Math.max(30, Math.round(durationInFrames)),
  });
}

export async function continueRender(operationId: string, geometry: string): Promise<RenderAnswer> {
  return executeHook<RenderAnswer>(RENDER_HOOK, { operationId, geometry });
}

export interface ExportVariant { url: string; bytes: number }
export interface ExportSizes {
  master: ExportVariant;
  compressed: ExportVariant | null;
  smaller: boolean;
  note: string;
}

/**
 * Measure the finished master and build the share-sized variant. Both byte
 * counts are REAL (measured server-side), and `smaller` is false when the
 * second pass did not actually shrink the file — the card then offers the
 * master alone instead of claiming a saving that did not happen.
 */
export async function buildExportVariants(masterUrl: string, op: 'measure' | 'compress' = 'compress'): Promise<ExportSizes> {
  const answer = await executeHook<any>(SHARE_HOOK, { masterUrl, op }, 180000);
  if (!answer?.success) throw new Error(String(answer?.error || 'The export finisher did not answer.'));
  return {
    master: { url: String(answer.master?.url || masterUrl), bytes: Number(answer.master?.bytes) || 0 },
    compressed: answer.compressed?.url
      ? { url: String(answer.compressed.url), bytes: Number(answer.compressed.bytes) || 0 }
      : null,
    smaller: !!answer.smaller,
    note: String(answer.note || ''),
  };
}

/**
 * Save the file to the visitor's device. Storage serves these objects without
 * CORS headers, so a blob download is attempted first and a new tab is the
 * fallback; the caller tells the creator which one happened rather than
 * leaving a dead button.
 */
export async function downloadVideo(url: string, filename: string): Promise<'downloaded' | 'opened'> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 20000);
    return 'downloaded';
  } catch {
    window.open(url, '_blank', 'noopener');
    return 'opened';
  }
}

// ---------------------------------------------------------------------------
// Persistence — autosave every 30 seconds into svenhancer_projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: number;
  title?: string | null;
  status?: string | null;
  duration_s?: number | string | null;
  frames?: number | null;
  source_url?: string | null;
  doc?: unknown;
  render_url?: string | null;
  render_operation_id?: string | null;
  render_geometry?: string | null;
  render_error?: string | null;
  updated_at?: string;
}

export function parseDoc(row: ProjectRow): EditDoc | null {
  let doc: unknown = row.doc;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { return null; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  return hydrateDoc(doc);
}

export async function listProjects(limit = 12): Promise<ProjectRow[]> {
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
