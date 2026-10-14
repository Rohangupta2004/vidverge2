/**
 * VIDEO PROVIDER LAB — Gemini Omni Flash section.
 *
 * A self-contained, owner-only panel that exposes the FULL Gemini Omni Flash
 * capability surface the platform can reach, each as its own mode:
 *
 *   1. Text-to-Video            POST /api/veo/generate/video  (image-and-video-generation)
 *   2. Image-to-Video           POST /api/veo/generate/video  + seed imageData
 *   3. Native Image Generation  POST /proxy/openai/v1/chat/completions · modalities:['text','image']
 *   4. Multimodal Understanding POST /proxy/openai/v1/chat/completions · image/text message parts
 *   5. Video Understanding      POST /api/generate/video-{youtube,inline,analysis}
 *   6. Audio Understanding      POST /api/generate/transcribe (+ chat follow-up)
 *   7. Live / Streaming         GET  /api/realtime/token  (note + token probe)
 *
 * Like the rest of the lab this is a developer test surface: it reports exactly
 * what each proxy answers rather than substituting a model or hiding an error.
 * No provider key, environment variable or BYOK secret appears here or reaches
 * the browser. `X-Workspace-DB-Token` (read live from window.__workspaceDb) is
 * the only credential sent, as every /proxy/openai/* and /api path requires.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  AlertCircle, Brain, CheckCircle2, Clapperboard, Download, FileAudio, Film,
  Image as ImageIcon, Mic, Radio, Scissors, Sparkles, Upload, Video as VideoIcon, X, Zap,
} from 'lucide-react';

import { MAX_IMAGE_BYTES, readImageFile, workspaceToken } from './labClient';

// ---------------------------------------------------------------------------
// Look — kept in step with the parent panel's palette
// ---------------------------------------------------------------------------

const C = {
  bg: '#0a0a0a',
  card: '#111111',
  raised: '#171717',
  line: '#242424',
  lineStrong: '#343434',
  accent: '#f59e0b',
  gemini: '#4f8cff',
  ink: '#f4f4f5',
  soft: '#c9c9d1',
  muted: '#86868f',
  good: '#22c55e',
  bad: '#f87171',
  warn: '#fbbf24',
};
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const STYLE_ID = 'gemini-omni-styles';

const CAPABILITY_BADGES = ['\uD83C\uDFA5 Video', '\uD83D\uDDBC\uFE0F Image', '\uD83C\uDF99\uFE0F Audio', '\uD83E\uDDE0 Multimodal', '\uD83D\uDCE1 Live'];

// ---------------------------------------------------------------------------
// Models (as named in the brief)
// ---------------------------------------------------------------------------

/** Gemini Omni Flash model ids the brief calls out, plus the exact video enum
 *  the /api/veo/generate/video proxy documents. */
const OMNI_MODELS = {
  flash20Exp: 'gemini-2.0-flash-exp',
  flash25: 'gemini-2.5-flash-preview-05-20',
  flashImage: 'gemini-2.0-flash-preview-image-generation',
};

/** Video generation ids from the documented /api/veo/generate/video enum. The
 *  Omni video model is `gemini-omni-flash-preview`; the Veo ids are offered so
 *  the same brief can be put through each engine side by side. */
const VIDEO_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-omni-flash-preview', label: 'Gemini Omni Flash (video)' },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1' },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' },
];

/** Chat models for multimodal understanding. The Gemini ids are the ones the
 *  brief names; the GPT ids are approved multimodal models on the openai proxy
 *  so the mode can also be exercised end to end. The lab reports verbatim
 *  whichever the proxy accepts or rejects. */
const UNDERSTAND_MODELS: { id: string; label: string }[] = [
  { id: OMNI_MODELS.flash25, label: 'Gemini 2.5 Flash' },
  { id: OMNI_MODELS.flash20Exp, label: 'Gemini 2.0 Flash (Omni)' },
  { id: 'gpt-4o', label: 'GPT-4o (approved multimodal)' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini (approved multimodal)' },
];

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

type ModeId = 't2v' | 'i2v' | 'videoEdit' | 'image' | 'multimodal' | 'videoUnderstand' | 'audio' | 'live';

interface ModeDef {
  id: ModeId;
  label: string;
  Icon: ComponentType<any>;
  blurb: string;
}

const MODES: ModeDef[] = [
  { id: 't2v', label: 'Text \u2192 Video', Icon: Film, blurb: 'Generate a clip from a text prompt through the image-and-video-generation plugin.' },
  { id: 'i2v', label: 'Image \u2192 Video', Icon: Clapperboard, blurb: 'Animate an uploaded seed image with a prompt.' },
  { id: 'videoEdit', label: 'Video \u2192 Edit', Icon: Scissors, blurb: 'Upload a source clip and describe what to change \u2014 Omni Flash rewrites the video according to your prompt (video-to-video editing, the same path Google Flow uses).' },
  { id: 'image', label: 'Native Image Gen', Icon: ImageIcon, blurb: 'Gemini native image output via the chat-completions proxy with modalities [text, image].' },
  { id: 'multimodal', label: 'Multimodal Understanding', Icon: Brain, blurb: 'Attach an image and ask a question — vision + language in one chat call.' },
  { id: 'videoUnderstand', label: 'Video Understanding', Icon: VideoIcon, blurb: 'Summaries, timestamped insights and Q&A over a YouTube URL or an uploaded video.' },
  { id: 'audio', label: 'Audio Understanding', Icon: Mic, blurb: 'Transcribe an audio file, then optionally ask the model to analyse the transcript.' },
  { id: 'live', label: 'Live / Streaming', Icon: Radio, blurb: 'Real-time voice/video (Gemini Live) runs through the OpenAI Realtime plugin.' },
];

// ---------------------------------------------------------------------------
// Network helpers — X-Workspace-DB-Token is the only credential sent
// ---------------------------------------------------------------------------

function jsonHeaders(): Record<string, string> {
  const token = workspaceToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Workspace-DB-Token': token } : {}),
  };
}

/** Multipart: never set Content-Type (the browser adds the boundary), but the
 *  workspace token still rides along. */
function multipartHeaders(): Record<string, string> {
  const token = workspaceToken();
  return token ? { 'X-Workspace-DB-Token': token } : {};
}

async function readJson(response: Response): Promise<any> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.code ? ` [${data.code}]` : '';
    const message = data?.error?.message || data?.error || data?.message || data?.errorMessage
      || `Request failed (${response.status})`;
    throw new Error(`${message}${code} (HTTP ${response.status})`);
  }
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

/** Poll a /api/veo video job to completion. Honest about timeout: the job keeps
 *  running on the provider; only this panel stops waiting. */
async function pollVeo(
  operationId: string,
  onNote: (note: string) => void,
  cancelled: () => boolean,
  capMs = 300000,
): Promise<string> {
  const path = `/api/veo/status/${encodeURIComponent(operationId)}`;
  const startedAt = Date.now();
  for (;;) {
    if (cancelled()) throw new Error('Cancelled.');
    await sleep(5000);
    if (cancelled()) throw new Error('Cancelled.');
    const state = await readJson(await fetch(path, { headers: jsonHeaders() }));
    const status = String(state?.status || '');
    if (status === 'failed') throw new Error(String(state?.errorMessage || 'The render failed.'));
    const url = String(state?.videoUrl || '');
    if ((state?.done === true || status === 'completed') && url) return url;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    onNote(`${status || 'processing'}\u2026 ${elapsed}s`);
    if (Date.now() - startedAt > capMs) {
      throw new Error(`Still rendering after ${Math.round(capMs / 1000)}s. The job may still land \u2014 operationId ${operationId}.`);
    }
  }
}

/** Read a File as a bare base64 string (no data: prefix) for the inline
 *  video-understanding endpoint. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

/** Walk any provider response for the first thing that looks like an image —
 *  a data:image URL or an http(s) image link — because the native-image chat
 *  response shape is not fixed across providers. */
function findImageUrl(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return value;
    if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(value)) return value;
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

/** Flatten chat message content (string or OpenAI content-part array) to text. */
function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('').trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function useOmniStyles() {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '@keyframes gof-spin { to { transform: rotate(360deg); } }',
      '.gof-btn { transition: filter 120ms ease, transform 120ms ease; }',
      '.gof-btn:hover:not(:disabled) { filter: brightness(1.14); }',
      '.gof-btn:active:not(:disabled) { transform: translateY(1px); }',
      '.gof-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
      '.gof-input:focus { outline: none; border-color: #4b4b4b; }',
    ].join('\n');
    document.head.appendChild(style);
  }, []);
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 13,
        height: 13,
        borderRadius: 99,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        display: 'inline-block',
        animation: 'gof-spin 0.8s linear infinite',
      }}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>
        {label}
      </div>
      {children}
      {hint ? <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>{hint}</div> : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: C.bg,
  color: C.ink,
  border: `1px solid ${C.lineStrong}`,
  borderRadius: 9,
  padding: '9px 12px',
  fontSize: 13,
  fontFamily: FONT,
  width: '100%',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  fontSize: 12.5,
  padding: '8px 10px',
};

function RunButton({ onClick, disabled, busy, label }: { onClick: () => void; disabled: boolean; busy: boolean; label: string }) {
  return (
    <button
      type="button"
      className="gof-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: C.gemini,
        color: '#0a0a0a',
        border: 'none',
        borderRadius: 9,
        padding: '10px 18px',
        fontSize: 13,
        fontWeight: 700,
        fontFamily: FONT,
        cursor: 'pointer',
      }}
    >
      {busy ? <Spinner color="#0a0a0a" /> : <Zap size={14} />} {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

type ResultKind = 'video' | 'image' | 'text';

interface OmniResult {
  kind: ResultKind;
  videoUrl?: string;
  imageUrl?: string;
  text?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function GeminiOmniFlash() {
  useOmniStyles();

  const [mode, setMode] = useState<ModeId>('t2v');

  // Shared-ish inputs per mode.
  const [videoPrompt, setVideoPrompt] = useState('A cinematic slow push-in on a glowing product on a studio pedestal, volumetric light, 35mm film grain');
  const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0].id);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [seedImage, setSeedImage] = useState('');

  const [videoEditFile, setVideoEditFile] = useState<File | null>(null);
  const [videoEditPrompt, setVideoEditPrompt] = useState('Remove the background and replace it with a sunlit outdoor cafe scene, keep the subject in the same position.');

  const [imagePrompt, setImagePrompt] = useState('A photorealistic golden V-shaped logo mark floating over a dark gradient, soft studio reflections');

  const [mmModel, setMmModel] = useState(UNDERSTAND_MODELS[0].id);
  const [mmImage, setMmImage] = useState('');
  const [mmQuestion, setMmQuestion] = useState('Describe this image in detail. What objects, text and mood do you see?');

  const [vuMode, setVuMode] = useState<'youtube' | 'file'>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [vuPrompt, setVuPrompt] = useState('Summarise this video and list the key moments with [MM:SS] timestamps.');

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioQuestion, setAudioQuestion] = useState('Summarise what is said and list any action items.');

  const [liveToken, setLiveToken] = useState('');

  // Run state.
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<OmniResult | null>(null);
  const [attachError, setAttachError] = useState('');

  const cancelRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; cancelRef.current = true; }, []);

  const hasToken = Boolean(workspaceToken());

  const resetRun = useCallback(() => {
    cancelRef.current = false;
    setError('');
    setNote('');
    setResult(null);
  }, []);

  const finishError = useCallback((err: unknown) => {
    if (!mounted.current) return;
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const attachImage = useCallback(async (file: File | undefined, set: (url: string) => void) => {
    setAttachError('');
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) { setAttachError(`${file.name} is not an image.`); return; }
    if (file.size > MAX_IMAGE_BYTES) { setAttachError(`${file.name} is over the ~10MB inline limit.`); return; }
    try {
      const dataUrl = await readImageFile(file);
      if (mounted.current) set(dataUrl);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not read the image.');
    }
  }, []);

  // -------------------------------------------------------------------------
  // Runners
  // -------------------------------------------------------------------------

  const runVideo = useCallback(async (withSeed: boolean) => {
    resetRun();
    if (videoPrompt.trim().length < 10) { setError('The prompt must be at least 10 characters.'); return; }
    if (withSeed && !seedImage) { setError('Attach a seed image to run image-to-video.'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        model: videoModel,
        prompt: videoPrompt.trim().slice(0, 10000),
        aspectRatio,
        generateAudio,
      };
      if (withSeed && seedImage) body.imageData = seedImage;
      setNote('Submitting to /api/veo/generate/video\u2026');
      const start = await readJson(await fetch('/api/veo/generate/video', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      }));
      const operationId = String(start?.operationId || start?.operation_id || '');
      if (!operationId) throw new Error('The proxy accepted the request but returned no operationId.');
      if (/_error_/.test(operationId)) {
        throw new Error(`Rejected upstream (synthetic id ${operationId}). ${String(start?.errorMessage || start?.message || '')}`.trim());
      }
      const videoUrl = await pollVeo(operationId, (n) => mounted.current && setNote(n), () => cancelRef.current);
      if (!mounted.current) return;
      setResult({
        kind: 'video',
        videoUrl,
        detail: `${videoModel}${start?.cost ? ` \u00b7 proxy quoted $${String(start.cost)}` : ''}`,
      });
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [aspectRatio, finishError, generateAudio, resetRun, seedImage, videoModel, videoPrompt]);

  const runNativeImage = useCallback(async () => {
    resetRun();
    if (imagePrompt.trim().length < 3) { setError('Enter a prompt.'); return; }
    setBusy(true);
    try {
      setNote('Requesting native image output via /proxy/openai/v1/chat/completions\u2026');
      const data = await readJson(await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          model: OMNI_MODELS.flashImage,
          modalities: ['text', 'image'],
          messages: [{ role: 'user', content: imagePrompt.trim() }],
        }),
      }));
      if (!mounted.current) return;
      const message = data?.choices?.[0]?.message;
      const imageUrl = findImageUrl(data);
      const text = messageText(message);
      if (imageUrl) {
        setResult({ kind: 'image', imageUrl, text: text || undefined, detail: OMNI_MODELS.flashImage });
      } else if (text) {
        setResult({ kind: 'text', text, detail: `${OMNI_MODELS.flashImage} \u2014 no image payload returned; text only` });
      } else {
        setResult({ kind: 'text', text: JSON.stringify(data, null, 2), detail: `${OMNI_MODELS.flashImage} \u2014 raw response` });
      }
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [finishError, imagePrompt, resetRun]);

  const runMultimodal = useCallback(async () => {
    resetRun();
    if (!mmImage) { setError('Attach an image to analyse.'); return; }
    if (mmQuestion.trim().length < 2) { setError('Enter a question.'); return; }
    setBusy(true);
    try {
      setNote(`Asking ${mmModel}\u2026`);
      const data = await readJson(await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          model: mmModel,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: mmQuestion.trim() },
              { type: 'image_url', image_url: { url: mmImage } },
            ],
          }],
          max_completion_tokens: 1200,
        }),
      }));
      if (!mounted.current) return;
      const text = messageText(data?.choices?.[0]?.message) || JSON.stringify(data, null, 2);
      setResult({ kind: 'text', text, detail: mmModel });
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [finishError, mmImage, mmModel, mmQuestion, resetRun]);

  const runVideoUnderstand = useCallback(async () => {
    resetRun();
    if (vuPrompt.trim().length < 3) { setError('Enter a question or instruction.'); return; }
    setBusy(true);
    try {
      let data: any;
      if (vuMode === 'youtube') {
        if (!/^https?:\/\//i.test(youtubeUrl.trim())) { setError('Enter a valid YouTube URL.'); setBusy(false); return; }
        setNote('Analysing the YouTube video\u2026');
        data = await readJson(await fetch('/api/generate/video-youtube', {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ prompt: vuPrompt.trim(), youtubeUrl: youtubeUrl.trim() }),
        }));
      } else {
        if (!videoFile) { setError('Choose a video file.'); setBusy(false); return; }
        if (videoFile.size <= 20 * 1024 * 1024) {
          setNote('Analysing the video inline\u2026');
          const base64 = await fileToBase64(videoFile);
          data = await readJson(await fetch('/api/generate/video-inline', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ prompt: vuPrompt.trim(), video: base64, mimeType: videoFile.type || 'video/mp4' }),
          }));
        } else {
          setNote('Uploading and analysing the video\u2026');
          const form = new FormData();
          form.append('file', videoFile);
          form.append('prompt', vuPrompt.trim());
          data = await readJson(await fetch('/api/generate/video-analysis', {
            method: 'POST',
            headers: multipartHeaders(),
            body: form,
          }));
        }
      }
      if (!mounted.current) return;
      const text = String(data?.result || data?.text || JSON.stringify(data, null, 2));
      setResult({ kind: 'text', text, detail: data?.metadata?.model ? `model ${String(data.metadata.model)}` : 'gemini video understanding' });
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [finishError, resetRun, videoFile, vuMode, vuPrompt, youtubeUrl]);

  const runAudio = useCallback(async () => {
    resetRun();
    if (!audioFile) { setError('Choose an audio file.'); return; }
    setBusy(true);
    try {
      setNote('Transcribing the audio\u2026');
      const form = new FormData();
      form.append('audio', audioFile, audioFile.name || 'recording.webm');
      const transcribeData = await readJson(await fetch('/api/generate/transcribe', {
        method: 'POST',
        headers: multipartHeaders(),
        body: form,
      }));
      const transcript = String(transcribeData?.text || '').trim();
      if (!mounted.current) return;
      if (!transcript) throw new Error('Transcription returned no text.');

      let analysis = '';
      if (audioQuestion.trim().length >= 2) {
        setNote('Understanding the transcript\u2026');
        const data = await readJson(await fetch('/proxy/openai/v1/chat/completions', {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({
            model: 'gpt-5.6-terra',
            reasoning_effort: 'none',
            messages: [
              { role: 'system', content: 'You analyse transcribed audio. Be concise and specific.' },
              { role: 'user', content: `${audioQuestion.trim()}\n\nTranscript:\n${transcript}` },
            ],
            max_completion_tokens: 1000,
          }),
        }));
        analysis = messageText(data?.choices?.[0]?.message);
      }
      if (!mounted.current) return;
      const text = analysis
        ? `\u2500\u2500 Transcript \u2500\u2500\n${transcript}\n\n\u2500\u2500 Understanding \u2500\u2500\n${analysis}`
        : transcript;
      setResult({ kind: 'text', text, detail: 'whisper transcription + chat understanding' });
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [audioFile, audioQuestion, finishError, resetRun]);

  const runVideoEdit = useCallback(async () => {
    resetRun();
    if (!videoEditFile) { setError('Upload a source video to edit.'); return; }
    if (videoEditPrompt.trim().length < 10) { setError('The edit prompt must be at least 10 characters.'); return; }
    setBusy(true);
    try {
      setNote('Reading the video file\u2026');
      const base64 = await fileToBase64(videoEditFile);
      const mime = videoEditFile.type || 'video/mp4';
      const videoData = `data:${mime};base64,${base64}`;
      const body: Record<string, unknown> = {
        model: 'gemini-omni-flash-preview',
        prompt: videoEditPrompt.trim(),
        aspectRatio,
        generateAudio,
        videoData,
      };
      setNote('Submitting to /api/veo/generate/video (video edit)\u2026');
      const start = await readJson(await fetch('/api/veo/generate/video', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      }));
      const operationId = String(start?.operationId || start?.operation_id || '');
      if (!operationId) throw new Error('The proxy accepted the request but returned no operationId.');
      if (/_error_/.test(operationId)) {
        throw new Error(`Rejected upstream (synthetic id ${operationId}). ${String(start?.errorMessage || start?.message || '')}`.trim());
      }
      const videoUrl = await pollVeo(
        operationId,
        (n) => { if (mounted.current) setNote(n); },
        () => cancelRef.current,
      );
      if (!mounted.current) return;
      setResult({
        kind: 'video',
        videoUrl,
        detail: `gemini-omni-flash-preview \u00b7 video edit${start?.cost ? ` \u00b7 proxy quoted $${String(start.cost)}` : ''}`,
      });
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [aspectRatio, finishError, generateAudio, resetRun, videoEditFile, videoEditPrompt]);

  const probeLiveToken = useCallback(async () => {
    resetRun();
    setLiveToken('');
    setBusy(true);
    try {
      setNote('Minting an ephemeral realtime token\u2026');
      const data = await readJson(await fetch('/api/realtime/token', { headers: jsonHeaders() }));
      if (!mounted.current) return;
      const token = String(data?.token || '');
      setLiveToken(token ? `${token.slice(0, 10)}\u2026 (model ${String(data?.model || 'gpt-realtime')}, expires ${data?.expires ? new Date(Number(data.expires)).toLocaleTimeString() : 'soon'})` : 'No token in response.');
    } catch (err) {
      finishError(err);
    } finally {
      if (mounted.current) { setBusy(false); setNote(''); }
    }
  }, [finishError, resetRun]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  // Reset transient output when the mode changes.
  useEffect(() => { setError(''); setNote(''); setResult(null); setAttachError(''); }, [mode]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const imagePicker = (current: string, set: (url: string) => void, labelText: string) => (
    <Field label={labelText}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
        <label
          className="gof-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: C.soft,
            border: `1px solid ${C.lineStrong}`, borderRadius: 9, padding: '8px 14px', fontSize: 12.5,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Upload size={14} /> {current ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void attachImage(file, set); }}
            style={{ display: 'none' }}
          />
        </label>
        {current ? (
          <div style={{ position: 'relative', width: 92, height: 68, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.lineStrong}` }}>
            <img src={current} alt="Attachment" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <button
              type="button"
              onClick={() => set('')}
              title="Remove"
              style={{ position: 'absolute', top: 3, right: 3, width: 19, height: 19, borderRadius: 5, border: 'none', background: 'rgba(0,0,0,0.65)', color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
            >
              <X size={11} />
            </button>
          </div>
        ) : null}
      </div>
      {attachError ? <div style={{ fontSize: 11, color: C.warn, marginTop: 8 }}>{attachError}</div> : null}
    </Field>
  );

  const aspectField = (
    <Field label="Aspect ratio">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['16:9', '9:16', '1:1'].map((ratio) => {
          const on = ratio === aspectRatio;
          return (
            <button
              key={ratio}
              type="button"
              className="gof-btn"
              onClick={() => setAspectRatio(ratio)}
              style={{
                background: on ? `${C.gemini}22` : 'transparent', color: on ? C.gemini : C.soft,
                border: `1px solid ${on ? `${C.gemini}66` : C.lineStrong}`, borderRadius: 7, padding: '5px 12px',
                fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              {ratio}
            </button>
          );
        })}
      </div>
    </Field>
  );

  const videoModelField = (
    <Field label="Model" hint="Omni Flash is the default; the Veo ids run the same brief through each engine for comparison.">
      <select value={videoModel} onChange={(event) => setVideoModel(event.target.value)} style={selectStyle}>
        {VIDEO_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label} — {model.id}</option>)}
      </select>
    </Field>
  );

  const audioToggle = (
    <Field label="Audio">
      <div style={{ display: 'flex', gap: 6 }}>
        {[{ id: 'off', label: 'Silent' }, { id: 'on', label: 'Generate audio' }].map((option) => {
          const on = (option.id === 'on') === generateAudio;
          return (
            <button
              key={option.id}
              type="button"
              className="gof-btn"
              onClick={() => setGenerateAudio(option.id === 'on')}
              style={{
                background: on ? `${C.gemini}22` : 'transparent', color: on ? C.gemini : C.soft,
                border: `1px solid ${on ? `${C.gemini}66` : C.lineStrong}`, borderRadius: 7, padding: '5px 12px',
                fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Field>
  );

  const textArea = (value: string, set: (v: string) => void, placeholder: string, rows = 3) => (
    <textarea
      className="gof-input"
      value={value}
      onChange={(event) => set(event.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
    />
  );

  function renderMode() {
    switch (mode) {
      case 't2v':
        return (
          <>
            {videoModelField}
            <Field label="Prompt" hint="10-10,000 characters.">{textArea(videoPrompt, setVideoPrompt, 'Describe the shot\u2026')}</Field>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{aspectField}{audioToggle}</div>
            <RunButton onClick={() => runVideo(false)} disabled={busy || !hasToken} busy={busy} label="Generate video" />
          </>
        );
      case 'i2v':
        return (
          <>
            {videoModelField}
            {imagePicker(seedImage, setSeedImage, 'Seed image (required)')}
            <Field label="Prompt" hint="Describe the motion to apply to the seed frame.">{textArea(videoPrompt, setVideoPrompt, 'Describe the motion\u2026')}</Field>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{aspectField}{audioToggle}</div>
            <RunButton onClick={() => runVideo(true)} disabled={busy || !hasToken} busy={busy} label="Animate image" />
          </>
        );
      case 'videoEdit':
        return (
          <>
            <Field label="Source video" hint="Upload the clip Omni Flash should edit. Keep it short (under 30s) for faster turnaround.">
              <input
                type="file"
                accept="video/*"
                onChange={(event) => setVideoEditFile(event.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: 8 }}
              />
              {videoEditFile ? (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                  {videoEditFile.name} · {(videoEditFile.size / 1024 / 1024).toFixed(1)}MB
                </div>
              ) : null}
            </Field>
            <Field label="Edit prompt" hint="Describe what to change — e.g. 'Remove the background', 'Add falling snow', 'Make it look cinematic with warm tones'.">
              {textArea(videoEditPrompt, setVideoEditPrompt, 'What should Omni Flash change about this video?')}
            </Field>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{aspectField}{audioToggle}</div>
            <RunButton
              onClick={runVideoEdit}
              disabled={busy || !hasToken || !videoEditFile}
              busy={busy}
              label="Edit video"
            />
          </>
        );
      case 'image':
        return (
          <>
            <Field label="Model"><div style={{ fontFamily: MONO, fontSize: 12, color: C.soft }}>{OMNI_MODELS.flashImage}</div></Field>
            <Field label="Prompt">{textArea(imagePrompt, setImagePrompt, 'Describe the image\u2026')}</Field>
            <RunButton onClick={runNativeImage} disabled={busy || !hasToken} busy={busy} label="Generate image" />
          </>
        );
      case 'multimodal':
        return (
          <>
            <Field label="Model">
              <select value={mmModel} onChange={(event) => setMmModel(event.target.value)} style={selectStyle}>
                {UNDERSTAND_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </Field>
            {imagePicker(mmImage, setMmImage, 'Image to analyse')}
            <Field label="Question">{textArea(mmQuestion, setMmQuestion, 'Ask something about the image\u2026', 2)}</Field>
            <RunButton onClick={runMultimodal} disabled={busy || !hasToken} busy={busy} label="Analyse" />
          </>
        );
      case 'videoUnderstand':
        return (
          <>
            <Field label="Source">
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ id: 'youtube', label: 'YouTube URL' }, { id: 'file', label: 'Upload file' }].map((option) => {
                  const on = option.id === vuMode;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="gof-btn"
                      onClick={() => setVuMode(option.id as 'youtube' | 'file')}
                      style={{
                        background: on ? `${C.gemini}22` : 'transparent', color: on ? C.gemini : C.soft,
                        border: `1px solid ${on ? `${C.gemini}66` : C.lineStrong}`, borderRadius: 7, padding: '5px 12px',
                        fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: FONT, cursor: 'pointer',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            {vuMode === 'youtube' ? (
              <Field label="YouTube URL"><input className="gof-input" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." style={inputStyle} /></Field>
            ) : (
              <Field label="Video file" hint="Under 20MB goes inline; larger uploads use the file endpoint.">
                <input type="file" accept="video/*" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} style={{ ...inputStyle, padding: 8 }} />
                {videoFile ? <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{videoFile.name} · {(videoFile.size / 1024 / 1024).toFixed(1)}MB</div> : null}
              </Field>
            )}
            <Field label="Prompt">{textArea(vuPrompt, setVuPrompt, 'What do you want to know about the video?')}</Field>
            <RunButton onClick={runVideoUnderstand} disabled={busy || !hasToken} busy={busy} label="Understand video" />
          </>
        );
      case 'audio':
        return (
          <>
            <Field label="Audio file" hint="webm, mp3, wav, m4a or ogg.">
              <input type="file" accept="audio/*,.webm,.mp3,.wav,.m4a,.ogg" onChange={(event) => setAudioFile(event.target.files?.[0] || null)} style={{ ...inputStyle, padding: 8 }} />
              {audioFile ? <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{audioFile.name} · {(audioFile.size / 1024 / 1024).toFixed(1)}MB</div> : null}
            </Field>
            <Field label="Understanding prompt" hint="Leave blank to only transcribe.">{textArea(audioQuestion, setAudioQuestion, 'What should the model do with the transcript?', 2)}</Field>
            <RunButton onClick={runAudio} disabled={busy || !hasToken} busy={busy} label="Transcribe + understand" />
          </>
        );
      case 'live':
        return (
          <>
            <div style={{ fontSize: 12.5, color: C.soft, lineHeight: 1.7 }}>
              Gemini Live (real-time, bidirectional voice and video) is not a request/response call. On this platform
              real-time sessions run through the <strong style={{ color: C.ink }}>OpenAI Realtime</strong> plugin: the
              app mints a short-lived token from <code style={{ fontFamily: MONO, color: C.gemini }}>GET /api/realtime/token</code>
              {' '}and connects over WebRTC with the <code style={{ fontFamily: MONO, color: C.gemini }}>@openai/agents-realtime</code> SDK.
              The button below mints a token to prove the plugin is reachable from this workspace.
            </div>
            <div style={{ marginTop: 14 }}>
              <RunButton onClick={probeLiveToken} disabled={busy || !hasToken} busy={busy} label="Mint realtime token" />
            </div>
            {liveToken ? (
              <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11.5, color: C.good, wordBreak: 'break-all' }}>
                <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />{liveToken}
              </div>
            ) : null}
          </>
        );
      default:
        return null;
    }
  }

  const activeMode = MODES.find((m) => m.id === mode) || MODES[0];

  return (
    <div
      style={{
        marginTop: 16,
        background: `linear-gradient(180deg, ${C.gemini}0f, ${C.card} 120px)`,
        border: `1px solid ${C.gemini}44`,
        borderRadius: 16,
        padding: 18,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 42, height: 42, borderRadius: 11, background: `${C.gemini}22`, border: `1px solid ${C.gemini}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <Sparkles size={21} color={C.gemini} />
        </div>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: -0.2 }}>Gemini Omni Flash</h2>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: C.gemini, background: `${C.gemini}1f`, border: `1px solid ${C.gemini}55`, borderRadius: 999, padding: '3px 9px' }}>
              full capability suite
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.soft, lineHeight: 1.6, maxWidth: 820 }}>
            Every Gemini Omni Flash modality behind one owner-only panel — video generation, native image output,
            multimodal and video/audio understanding, and the real-time Live path — each hitting the platform proxy
            with <code style={{ fontFamily: MONO, color: C.gemini }}>X-Workspace-DB-Token</code> and reporting exactly
            what it answers.
          </p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
            {CAPABILITY_BADGES.map((badge) => (
              <span key={badge} style={{ fontSize: 11, color: C.soft, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 7, padding: '3px 9px' }}>{badge}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 16 }}>
        {MODES.map((m) => {
          const on = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              className="gof-btn"
              onClick={() => setMode(m.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: on ? C.gemini : 'transparent', color: on ? '#0a0a0a' : C.soft,
                border: `1px solid ${on ? C.gemini : C.lineStrong}`, borderRadius: 9, padding: '7px 13px',
                fontSize: 12.5, fontWeight: on ? 700 : 500, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              <m.Icon size={14} /> {m.label}
            </button>
          );
        })}
      </div>

      {/* Mode body */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
        {/* Inputs */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 13, padding: 15 }}>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
            <activeMode.Icon size={14} color={C.gemini} style={{ verticalAlign: 'middle', marginRight: 7 }} />
            {activeMode.blurb}
          </div>
          {!hasToken ? (
            <div style={{ fontSize: 11.5, color: C.bad, marginBottom: 12, lineHeight: 1.6 }}>
              X-Workspace-DB-Token is missing on this page, so every proxy call would 401. Reload the space and retry.
            </div>
          ) : null}
          {renderMode()}
          {busy ? (
            <button
              type="button"
              className="gof-btn"
              onClick={cancel}
              style={{ marginLeft: 10, background: 'transparent', color: C.soft, border: `1px solid ${C.lineStrong}`, borderRadius: 9, padding: '10px 16px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, cursor: 'pointer' }}
            >
              Stop
            </button>
          ) : null}
        </div>

        {/* Output */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 13, padding: 15, minHeight: 160 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, marginBottom: 12 }}>
            Output
          </div>

          {busy ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.soft, fontSize: 12.5 }}>
              <Spinner color={C.gemini} /> {note || 'Working\u2026'}
            </div>
          ) : null}

          {!busy && error ? (
            <div style={{ background: `${C.bad}14`, border: `1px solid ${C.bad}44`, borderRadius: 9, padding: '10px 12px', display: 'flex', gap: 9 }}>
              <AlertCircle size={15} color={C.bad} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11.5, color: '#fca5a5', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: MONO }}>{error}</div>
            </div>
          ) : null}

          {!busy && !error && !result ? (
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>Run a mode to see its output here.</div>
          ) : null}

          {!busy && result?.kind === 'video' && result.videoUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <video src={result.videoUrl} controls playsInline preload="metadata" style={{ width: '100%', borderRadius: 10, background: '#000', border: `1px solid ${C.line}`, display: 'block' }} />
              <a href={result.videoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.gemini, textDecoration: 'none' }}>
                <Download size={13} /> Open MP4
              </a>
            </div>
          ) : null}

          {!busy && result?.kind === 'image' && result.imageUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <img src={result.imageUrl} alt="Generated" style={{ width: '100%', borderRadius: 10, border: `1px solid ${C.line}`, display: 'block' }} />
              <a href={result.imageUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.gemini, textDecoration: 'none' }}>
                <Download size={13} /> Open image
              </a>
              {result.text ? <div style={{ fontSize: 12, color: C.soft, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.text}</div> : null}
            </div>
          ) : null}

          {!busy && result?.kind === 'text' && result.text ? (
            <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT, maxHeight: 440, overflow: 'auto' }}>
              {result.text}
            </div>
          ) : null}

          {!busy && result?.detail ? (
            <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, marginTop: 10, wordBreak: 'break-all' }}>
              <FileAudio size={11} style={{ verticalAlign: 'middle', marginRight: 5, opacity: 0 }} />{result.detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
