/**
 * Script / Voice-to-Video — a Product Video input mode.
 *
 * The customer pastes a narration script OR uploads/records a voice track,
 * optionally adds 1–10 product screenshots, and claude-opus-5 aligns the
 * screenshots to the narration: the script is divided into contiguous
 * segments — one per screenshot, distributed evenly in sequence — each timed
 * against the total runtime. Output matches the product launch video format:
 * screenshots displayed sequentially with the matching narration overlay,
 * played against the customer's own voice file (used directly, never
 * re-synthesized) or an optional ElevenLabs voiceover for typed scripts.
 *
 * Timing: with a voice file the transcribed audio length is the runtime;
 * with a typed script it is estimated at 150 words ≈ 60 seconds (linear).
 * When screenshots are provided they are the ONLY images used — nothing is
 * generated or fetched. With no screenshots the preview falls back to brand
 * tiles carrying the narration as large captions.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Clock,
  ImagePlus,
  Loader2,
  Mic,
  Pause,
  Play,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { trackB } from '../../lib/trackB/api';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  panelStrong: 'var(--space-surface-panel-strong)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
};

const WORKSPACE_ID = (window as any).__WORKSPACE_ID__ || (window as any).__workspaceDb?.workspaceId || 'f24710e5-7c6d-4db4-92b4-c2c235877575';
function wsToken() { return (window as any).__workspaceDb?.token || ''; }

const MAX_SHOTS = 10;
const ACCEPT_AUDIO = '.mp3,.wav,.m4a,.webm,.ogg,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4,audio/webm,audio/ogg';
/** Sarah — the platform's default premade ElevenLabs voice. */
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export interface TimedSegment { imageIndex: number; startSec: number; endSec: number; text: string }

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 };
const inputStyle: React.CSSProperties = { boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13 };
const panelStyle: React.CSSProperties = { borderRadius: 16, border: `1px solid ${S.border}`, background: S.panel, padding: 18, marginBottom: 18 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' };

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ marginTop: 12, padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: S.danger, background: `color-mix(in srgb, ${S.danger} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${S.danger} 30%, transparent)` }}>
      {message}
    </div>
  );
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** 150 words ≈ 60 seconds, scaled linearly. Floors at 4s so a one-liner still plays. */
function estimateSecondsFromWords(words: number): number {
  return Math.max(4, Math.round((words / 150) * 60));
}

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Read a local audio blob's real duration off its metadata (0 when unreadable). */
function readAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
      probe.onerror = () => resolve(0);
      probe.src = url;
    } catch {
      resolve(0);
    }
  });
}

/**
 * Transcribe a voice recording. Tries the product-spec endpoint first
 * (POST /api/generate/transcribe — multipart, field `audio`), then falls back
 * to the workspace's proven Deepgram endpoint with the identical multipart
 * shape, so a customer's recording never dead-ends on one route.
 */
async function transcribeAudio(blob: Blob, filename: string): Promise<{ text: string; duration: number }> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const post = async (url: string) => {
    const form = new FormData();
    form.append('audio', blob, filename);
    const res = await fetch(url, { method: 'POST', headers: { 'X-Workspace-DB-Token': token }, body: form });
    const data = await res.json().catch(() => null);
    return { res, data };
  };
  let { res, data } = await post('/api/generate/transcribe');
  let text = data && (data.text || data.transcript || data.transcription);
  if (!res.ok || !text) {
    ({ res, data } = await post(`/api/workspaces/${WORKSPACE_ID}/audio/transcribe-timestamped`));
    text = data && (data.transcript || data.text);
    if (!res.ok || !data?.success || !text) {
      throw new Error((data && (data.error as string)) || `Transcription failed (HTTP ${res.status}). Try a different audio file.`);
    }
  }
  return { text: String(text).trim(), duration: Number(data?.duration) || 0 };
}

/** Deterministic fallback: split the script's words evenly across N slots. */
function evenSegments(script: string, slots: number, totalSec: number): TimedSegment[] {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const n = Math.max(1, slots);
  const per = Math.ceil(words.length / n) || 1;
  const out: TimedSegment[] = [];
  for (let i = 0; i < n; i++) {
    const chunk = words.slice(i * per, (i + 1) * per).join(' ');
    const startSec = Math.round(((i * totalSec) / n) * 10) / 10;
    const endSec = Math.round((((i + 1) * totalSec) / n) * 10) / 10;
    out.push({ imageIndex: i, startSec, endSec, text: chunk || '…' });
  }
  return out;
}

/**
 * claude-opus-5 aligns the script to the screenshots: contiguous segments in
 * order, one per image, distributed evenly, timed to the total runtime. Any
 * malformed reply falls back to the deterministic even split — never a dead end.
 */
async function matchScriptToScreenshots(script: string, imageCount: number, totalSec: number): Promise<TimedSegment[]> {
  const n = Math.max(1, imageCount);
  const prompt =
    `You are timing a product video. A narration script and ${n} product screenshot(s) are provided. ` +
    `The screenshots are indexed 0 to ${n - 1} and are shown in sequence — never reordered, never skipped, and no other images exist. ` +
    `Divide the script into exactly ${n} contiguous segments, in order, distributing the script evenly across the provided screenshots in sequence. ` +
    `The total video duration is ${totalSec} seconds: the first segment starts at 0, the last ends at ${totalSec}, segments are contiguous (each startSec equals the previous endSec), and each segment's share of time is proportional to its share of the words. ` +
    `Respond with ONLY a JSON array and no other prose, exactly this shape: ` +
    `[{ "imageIndex": number, "startSec": number, "endSec": number, "text": string }]\n\nScript:\n${script}`;
  try {
    const res = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() },
      body: JSON.stringify({ model: 'claude-opus-5', max_tokens: 3200, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.error?.message || '')) || `AI request failed (${res.status})`);
    const raw = Array.isArray(data?.content) ? data.content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('') : '';
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('no JSON array in reply');
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('empty segment list');
    const cleaned: TimedSegment[] = parsed
      .map((s: any, i: number) => ({
        imageIndex: Math.min(n - 1, Math.max(0, Math.round(Number(s?.imageIndex ?? i)))),
        startSec: Math.max(0, Number(s?.startSec) || 0),
        endSec: Math.min(totalSec, Number(s?.endSec) || 0),
        text: String(s?.text ?? '').trim(),
      }))
      .filter((s: TimedSegment) => s.text && s.endSec > s.startSec)
      .sort((a: TimedSegment, b: TimedSegment) => a.startSec - b.startSec);
    if (!cleaned.length) throw new Error('no usable segments');
    // Re-anchor so the timeline is contiguous and spans the full runtime.
    cleaned[0].startSec = 0;
    for (let i = 1; i < cleaned.length; i++) cleaned[i].startSec = cleaned[i - 1].endSec;
    cleaned[cleaned.length - 1].endSec = totalSec;
    return cleaned;
  } catch (e) {
    console.warn('[ScriptToVideo] LLM matching fell back to the even split:', e);
    return evenSegments(script, n, totalSec);
  }
}

export default function ScriptToVideo() {
  // --- input step -----------------------------------------------------------
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [script, setScript] = useState('');
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioFileRef = useRef<HTMLInputElement | null>(null);

  // --- screenshots step (optional) ------------------------------------------
  const [shots, setShots] = useState<string[]>([]);
  const [uploadingShots, setUploadingShots] = useState(false);
  const [shotError, setShotError] = useState<string | null>(null);

  // --- matching + output -----------------------------------------------------
  const [segments, setSegments] = useState<TimedSegment[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [totalSec, setTotalSec] = useState(0);
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [generatingTts, setGeneratingTts] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // --- playback --------------------------------------------------------------
  const [currentTime, setCurrentTime] = useState(0);
  const [captionPlaying, setCaptionPlaying] = useState(false);
  const captionTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (captionTimerRef.current != null) window.clearInterval(captionTimerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* no-op */ }
    }
  }, []);

  const words = wordCount(script);
  const estimatedSec = voiceUrl && voiceDuration > 0 ? Math.round(voiceDuration) : estimateSecondsFromWords(words);
  const audioTrackUrl = voiceUrl || ttsUrl;

  // ---------------------------------------------------------------------------
  // Voice intake: upload or in-browser recording → transcription
  // ---------------------------------------------------------------------------
  const ingestVoiceBlob = async (blob: Blob, filename: string) => {
    setInputError(null);
    setTranscribing(true);
    try {
      const url = URL.createObjectURL(blob);
      const metaDuration = await readAudioDuration(url);
      const { text, duration } = await transcribeAudio(blob, filename);
      if (!text) throw new Error('The recording came back with no words — try a clearer take.');
      setVoiceUrl(url);
      setVoiceName(filename);
      setVoiceDuration(metaDuration || duration || estimateSecondsFromWords(wordCount(text)));
      setScript(text);
      setSegments(null);
      setTtsUrl(null);
    } catch (e) {
      setInputError(e instanceof Error ? e.message : 'Transcription failed — please try again.');
    } finally {
      setTranscribing(false);
    }
  };

  const onAudioFile = (file: File | null) => {
    if (!file) return;
    void ingestVoiceBlob(file, file.name || 'voice.mp3');
  };

  const startRecording = async () => {
    setInputError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size) void ingestVoiceBlob(blob, 'recording.webm');
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setInputError('The microphone could not be started — check browser permissions, or upload a file instead.');
    }
  };

  const stopRecording = () => {
    setRecording(false);
    try { recorderRef.current?.stop(); } catch { /* no-op */ }
  };

  const clearVoice = () => {
    setVoiceUrl(null);
    setVoiceName('');
    setVoiceDuration(0);
    setSegments(null);
  };

  // ---------------------------------------------------------------------------
  // Screenshots (optional, 1–10) — uploaded via the platform file-storage path
  // ---------------------------------------------------------------------------
  const onShotFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setShotError(null);
    setUploadingShots(true);
    try {
      const next: string[] = [];
      for (const f of Array.from(files).slice(0, Math.max(0, MAX_SHOTS - shots.length))) {
        if (!f.type.startsWith('image/')) continue;
        const r = await trackB.uploadScreenshot(f);
        if (r.success && r.url) next.push(r.url);
        else setShotError(r.error ?? 'A screenshot could not be uploaded.');
      }
      if (next.length) {
        setShots((cur) => [...cur, ...next].slice(0, MAX_SHOTS));
        setSegments(null);
      }
    } finally {
      setUploadingShots(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Generate: LLM matches script → screenshots, timed to the runtime
  // ---------------------------------------------------------------------------
  const generate = async () => {
    setMatchError(null);
    const text = script.trim();
    if (!text) {
      setMatchError(inputMode === 'voice' ? 'Add a voice recording first — its transcript becomes the script.' : 'Paste or type your narration script first.');
      return;
    }
    setMatching(true);
    try {
      const duration = estimatedSec;
      // With screenshots: one segment per screenshot (they are the only images
      // used). Without: 3–8 caption beats over brand tiles.
      const slots = shots.length > 0 ? shots.length : Math.min(8, Math.max(3, Math.ceil(wordCount(text) / 40)));
      const timed = shots.length > 0
        ? await matchScriptToScreenshots(text, shots.length, duration)
        : evenSegments(text, slots, duration);
      setSegments(timed);
      setTotalSec(duration);
      setCurrentTime(0);
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : 'The script could not be matched — please try again.');
    } finally {
      setMatching(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Optional voiceover for typed scripts (a real voice file is used directly)
  // ---------------------------------------------------------------------------
  const generateVoiceover = async () => {
    setTtsError(null);
    const text = script.trim();
    if (!text) return;
    setGeneratingTts(true);
    try {
      const res = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() },
        body: JSON.stringify({ script: text, voiceId: DEFAULT_VOICE_ID }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.audioUrl) {
        throw new Error((data && (typeof data.error === 'string' ? data.error : data.error?.message)) || `Voiceover generation failed (${res.status})`);
      }
      setTtsUrl(String(data.audioUrl));
      setCurrentTime(0);
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : 'Voiceover generation failed — captions-only playback still works.');
    } finally {
      setGeneratingTts(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Captions-only playback clock (used when there is no audio track)
  // ---------------------------------------------------------------------------
  const stopCaptionPlayback = () => {
    setCaptionPlaying(false);
    if (captionTimerRef.current != null) {
      window.clearInterval(captionTimerRef.current);
      captionTimerRef.current = null;
    }
  };

  const toggleCaptionPlayback = () => {
    if (captionPlaying) { stopCaptionPlayback(); return; }
    const startedAt = performance.now() - Math.min(currentTime, totalSec) * 1000;
    setCaptionPlaying(true);
    captionTimerRef.current = window.setInterval(() => {
      const t = (performance.now() - startedAt) / 1000;
      if (t >= totalSec) {
        setCurrentTime(0);
        stopCaptionPlayback();
      } else {
        setCurrentTime(t);
      }
    }, 100);
  };

  const activeSegment = segments?.find((s) => currentTime >= s.startSec && currentTime < s.endSec) || (segments && currentTime >= totalSec - 0.05 ? segments[segments.length - 1] : null);
  const activeShot = activeSegment && shots.length > 0 ? shots[Math.min(shots.length - 1, Math.max(0, activeSegment.imageIndex))] : null;

  const modeTab = (mode: 'text' | 'voice', icon: React.ReactNode, label: string, testId: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={inputMode === mode}
      onClick={() => setInputMode(mode)}
      className="ps-btn"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 15px', borderRadius: 9, border: 'none', background: inputMode === mode ? 'var(--space-brand-primary-600)' : 'transparent', color: inputMode === mode ? 'var(--space-text-on-primary)' : S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
      data-testid={testId}
    >
      {icon} {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800 }}>
          <AudioLines size={22} color="var(--space-text-brand)" /> Script to Video
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: S.sub }}>
          Paste a script or upload a voice recording, add your product screenshots, and the AI times each screenshot to its part of the narration — exactly like a product launch video.
        </p>
      </header>

      {/* 1 — Script or voice input */}
      <section style={panelStyle} data-testid="panel-stv-input">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ ...labelStyle, marginBottom: 0 }}>1 · Your narration</span>
          <div role="radiogroup" aria-label="Narration input mode" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: `1px solid ${S.border}`, background: S.panelStrong }}>
            {modeTab('text', <Type size={13} />, 'Text script', 'tab-stv-text')}
            {modeTab('voice', <Mic size={13} />, 'Voice recording', 'tab-stv-voice')}
          </div>
        </div>

        {inputMode === 'text' ? (
          <textarea
            value={script}
            onChange={(e) => { setScript(e.currentTarget.value); setSegments(null); }}
            rows={7}
            placeholder={'Paste your narration script verbatim…\n\nEvery word here is spoken (or shown) exactly as written — the AI only decides which screenshot appears alongside each part.'}
            className="ps-input"
            style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.55 }}
            data-testid="input-stv-script"
          />
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => !transcribing && audioFileRef.current?.click()} className="ps-btn" style={{ ...ghostBtn, opacity: transcribing ? 0.6 : 1 }} data-testid="button-stv-upload-audio">
                {transcribing ? <Loader2 size={13} className="rc-spin" /> : <Upload size={13} />}
                {transcribing ? 'Transcribing…' : 'Upload audio (mp3 / wav / m4a / webm / ogg)'}
              </button>
              <button
                type="button"
                onClick={() => (recording ? stopRecording() : void startRecording())}
                disabled={transcribing}
                className="ps-btn"
                style={{ ...(recording ? { ...primaryBtn, background: S.danger } : ghostBtn), opacity: transcribing ? 0.6 : 1 }}
                data-testid="button-stv-record"
              >
                {recording ? <Square size={13} /> : <Mic size={13} />}
                {recording ? 'Stop recording' : 'Record in browser'}
              </button>
              <input
                ref={audioFileRef}
                type="file"
                accept={ACCEPT_AUDIO}
                style={{ display: 'none' }}
                onClick={(e) => { e.currentTarget.value = ''; }}
                onChange={(e) => onAudioFile(e.currentTarget.files?.[0] ?? null)}
                data-testid="input-stv-audio-file"
              />
            </div>
            {voiceUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12, padding: '9px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.panelStrong }} data-testid="card-stv-voice">
                <AudioLines size={14} color="var(--space-text-brand)" />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{voiceName || 'Voice recording'}</span>
                <span style={{ fontSize: 12, color: S.muted }}>{voiceDuration ? formatSeconds(voiceDuration) : ''}</span>
                <audio src={voiceUrl} controls preload="metadata" style={{ height: 30, flex: '1 1 200px', minWidth: 160 }} />
                <button type="button" onClick={clearVoice} aria-label="Remove voice recording" className="ps-btn" style={{ padding: 7, borderRadius: 9, border: `1px solid color-mix(in srgb, ${S.danger} 35%, transparent)`, background: S.card, color: S.danger, cursor: 'pointer', display: 'inline-flex' }} data-testid="button-stv-remove-voice">
                  <Trash2 size={12} />
                </button>
              </div>
            ) : null}
            {script.trim() ? (
              <div style={{ marginTop: 12 }}>
                <label style={labelStyle} htmlFor="stv-transcript">Transcript (editable)</label>
                <textarea
                  id="stv-transcript"
                  value={script}
                  onChange={(e) => { setScript(e.currentTarget.value); setSegments(null); }}
                  rows={5}
                  className="ps-input"
                  style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.55 }}
                  data-testid="input-stv-transcript"
                />
              </div>
            ) : null}
          </div>
        )}
        <ErrorBanner message={inputError} />
      </section>

      {/* 2 — Screenshots (optional) */}
      <section style={panelStyle} data-testid="panel-stv-shots">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ ...labelStyle, marginBottom: 0 }}>2 · Product screenshots <span style={{ color: S.muted, textTransform: 'none', letterSpacing: 0 }}>(optional — up to {MAX_SHOTS})</span></span>
          <span style={{ fontSize: 11.5, color: S.muted }}>If you add screenshots they are the only images used — nothing else is generated or fetched.</span>
        </div>
        <div style={{ borderRadius: 10, border: `1px dashed ${S.border}`, background: S.card, padding: 10, marginTop: 8 }}>
          <label className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, border: `1px solid ${S.border}`, background: S.panelStrong, color: S.sub, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-stv-upload-shots">
            {uploadingShots ? <Loader2 size={12} className="rc-spin" /> : <ImagePlus size={12} />}
            {uploadingShots ? 'Uploading…' : 'Upload screenshots / mockups'}
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void onShotFiles(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid="input-stv-shots" />
          </label>
          <p style={{ margin: '7px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
            Skip this and the video plays your narration over branded caption slides instead.
          </p>
          {shots.length ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {shots.map((u, i) => (
                <span key={u} style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={u} alt={`Screenshot ${i + 1}`} style={{ width: 72, height: 46, objectFit: 'cover', borderRadius: 7, border: `1px solid ${S.border}` }} />
                  <span style={{ position: 'absolute', bottom: 3, left: 4, padding: '0 5px', borderRadius: 6, fontSize: 9.5, fontWeight: 800, color: '#fff', background: 'rgba(4,8,18,0.72)' }}>{i + 1}</span>
                  <button type="button" aria-label={`Remove screenshot ${i + 1}`} onClick={() => { setShots((cur) => cur.filter((x) => x !== u)); setSegments(null); }}
                    style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, padding: 0, borderRadius: 999, border: 'none', background: S.danger, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <ErrorBanner message={shotError} />
      </section>

      {/* 3 — Duration + generate */}
      <section style={panelStyle} data-testid="panel-stv-generate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999, border: `1px solid ${S.border}`, background: S.panelStrong, fontSize: 12.5, fontWeight: 700, color: S.sub }} data-testid="chip-stv-duration">
            <Clock size={13} color="var(--space-text-brand)" />
            Estimated video duration: {script.trim() ? formatSeconds(estimatedSec) : '—'}
            <span style={{ fontWeight: 600, color: S.muted }}>
              {voiceUrl && voiceDuration > 0 ? '(from your recording)' : script.trim() ? `(${words} words ≈ 150 words/min)` : ''}
            </span>
          </span>
          <button type="button" onClick={() => void generate()} disabled={matching || transcribing} className="ps-btn" style={{ ...primaryBtn, opacity: matching || transcribing ? 0.6 : 1 }} data-testid="button-stv-generate">
            {matching ? <Loader2 size={14} className="rc-spin" /> : <Wand2 size={14} />}
            {matching ? 'Matching script to visuals…' : shots.length ? `Match script to ${shots.length} screenshot${shots.length === 1 ? '' : 's'}` : 'Build the timed video'}
          </button>
        </div>
        <ErrorBanner message={matchError} />
      </section>

      {/* 4 — Timed preview: screenshots in sequence + narration overlay */}
      {segments ? (
        <section className="ps-fade-up" style={panelStyle} data-testid="panel-stv-preview">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Timed preview · {formatSeconds(totalSec)}</span>
            {!voiceUrl ? (
              <button type="button" onClick={() => void generateVoiceover()} disabled={generatingTts} className="ps-btn" style={{ ...ghostBtn, opacity: generatingTts ? 0.6 : 1 }} data-testid="button-stv-voiceover">
                {generatingTts ? <Loader2 size={13} className="rc-spin" /> : <Sparkles size={13} />}
                {generatingTts ? 'Generating voiceover…' : ttsUrl ? 'Regenerate voiceover' : 'Add AI voiceover (optional)'}
              </button>
            ) : (
              <span style={{ fontSize: 11.5, color: S.muted }}>Audio track: your own recording — used directly, never re-synthesized.</span>
            )}
          </div>
          <ErrorBanner message={ttsError} />

          <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(160deg, #05070f, #0b1020)', border: `1px solid ${S.borderStrong}`, marginTop: ttsError ? 12 : 0 }} data-testid="stage-stv">
            {activeShot ? (
              <img src={activeShot} alt="Current screenshot" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, var(--space-brand-primary-700), var(--space-brand-primary-500) 55%, var(--space-brand-highlight-600))', opacity: 0.35 }} />
            )}
            {activeSegment ? (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '34px 20px 16px', background: 'linear-gradient(180deg, transparent, rgba(3,6,14,0.82))', display: 'flex', justifyContent: 'center' }}>
                <span style={{ maxWidth: '88%', color: '#fff', fontSize: activeShot ? 'clamp(13px, 1.8vw, 19px)' : 'clamp(16px, 2.4vw, 26px)', fontWeight: 700, lineHeight: 1.45, textAlign: 'center', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }} data-testid="stage-stv-caption">
                  {activeSegment.text}
                </span>
              </div>
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)' }}>VidVerge</span>
              </div>
            )}
          </div>

          {audioTrackUrl ? (
            <audio
              key={audioTrackUrl}
              src={audioTrackUrl}
              controls
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onEnded={() => setCurrentTime(0)}
              style={{ display: 'block', width: '100%', marginTop: 12 }}
              data-testid="audio-stv-player"
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <button type="button" onClick={toggleCaptionPlayback} className="ps-btn" style={primaryBtn} data-testid="button-stv-play-captions">
                {captionPlaying ? <Pause size={14} /> : <Play size={14} />}
                {captionPlaying ? 'Pause' : 'Play with captions'}
              </button>
              <span style={{ fontSize: 12, color: S.muted }}>{formatSeconds(currentTime)} / {formatSeconds(totalSec)}</span>
            </div>
          )}

          <div className="ps-scroll-x" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingTop: 12 }} data-testid="timeline-stv">
            {segments.map((seg, i) => {
              const isActive = activeSegment === seg;
              return (
                <span key={`${seg.startSec}-${i}`} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: isActive ? 'var(--space-text-on-primary)' : S.sub, background: isActive ? 'var(--space-brand-primary-600)' : S.card, border: `1px solid ${isActive ? 'var(--space-brand-primary-600)' : S.border}`, transition: 'background .16s ease, color .16s ease' }} data-testid={`timeline-stv-chip-${i}`}>
                  {shots.length ? `Shot ${Math.min(shots.length, seg.imageIndex + 1)}` : `Beat ${i + 1}`}
                  <span style={{ fontWeight: 600, opacity: 0.75 }}>{formatSeconds(seg.startSec)}–{formatSeconds(seg.endSec)}</span>
                </span>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
