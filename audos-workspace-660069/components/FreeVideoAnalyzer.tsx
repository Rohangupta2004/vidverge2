import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Film, Link2, Loader2, Sparkles, Upload } from 'lucide-react';

interface ScoreSet {
  hook: number;
  pacing: number;
  captions: number;
  audio: number;
  framing: number;
}

export interface SuggestedEdit {
  timestamp: string;
  issue: string;
  fix: string;
}

interface Analysis {
  scores: ScoreSet;
  summary: string;
  edits: SuggestedEdit[];
  overLimit?: boolean;
}

const RATE_KEY = 'vidverge:free-analyser:last-success';
const MAX_SECONDS = 180;
const ANALYSIS_PROMPT = `Act as a short-form video editor. The video must be no longer than 3 minutes. If it is longer, return {"overLimit":true,"scores":{"hook":0,"pacing":0,"captions":0,"audio":0,"framing":0},"summary":"This video is over the 3 minute limit.","edits":[]}.
Otherwise score hook, pacing, captions, audio and framing from 0 to 100. Give a concise summary and 3-7 timestamped edits. Return ONLY valid JSON in this exact shape: {"scores":{"hook":number,"pacing":number,"captions":number,"audio":number,"framing":number},"summary":string,"edits":[{"timestamp":"MM:SS","issue":string,"fix":string}]}.`; 

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function usedToday(): boolean {
  try { return window.localStorage.getItem(RATE_KEY) === today(); }
  catch { return false; }
}

function markUsed(): void {
  try { window.localStorage.setItem(RATE_KEY, today()); } catch {}
}

function clampScore(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function parseAnalysis(value: unknown): Analysis {
  const raw = String(value || '').trim();
  const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  const parsed = JSON.parse(json);
  const scores = parsed?.scores || {};
  return {
    scores: {
      hook: clampScore(scores.hook),
      pacing: clampScore(scores.pacing),
      captions: clampScore(scores.captions),
      audio: clampScore(scores.audio),
      framing: clampScore(scores.framing),
    },
    summary: String(parsed?.summary || 'Analysis complete.'),
    edits: (Array.isArray(parsed?.edits) ? parsed.edits : []).slice(0, 7).map((edit: any) => ({
      timestamp: String(edit?.timestamp || '00:00'),
      issue: String(edit?.issue || 'This moment could be clearer.'),
      fix: String(edit?.fix || 'Tighten this section.'),
    })),
    overLimit: Boolean(parsed?.overLimit),
  };
}

function durationOf(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That video could not be opened. Use MP4, MOV or WebM.'));
    };
    video.src = url;
  });
}

async function analyzeFile(file: File): Promise<Analysis> {
  const duration = await durationOf(file);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video duration could not be measured. Try another file.');
  if (duration > MAX_SECONDS + 0.25) throw new Error('This analyser accepts videos up to 3 minutes. Trim the video and try again.');
  const form = new FormData();
  form.append('file', file, file.name || 'video.mp4');
  form.append('prompt', ANALYSIS_PROMPT);
  const response = await fetch('/api/generate/video-analysis', { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success) throw new Error(String(data?.error || 'The video could not be analysed.'));
  return parseAnalysis(data.result);
}

async function analyzeUrl(url: string): Promise<Analysis> {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error('Paste a full public video URL beginning with http:// or https://.');
  if (/youtu(?:\.be|be\.com)/i.test(clean)) {
    const response = await fetch('/api/generate/video-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtubeUrl: clean, prompt: ANALYSIS_PROMPT }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) throw new Error(String(data?.error || 'That video could not be analysed.'));
    return parseAnalysis(data.result);
  }
  let response: Response;
  try { response = await fetch(clean); }
  catch { throw new Error('That host does not allow the video to be read. Upload the file instead.'); }
  if (!response.ok) throw new Error(`That video URL answered ${response.status}. Upload the file instead.`);
  const blob = await response.blob();
  const type = blob.type || 'video/mp4';
  if (!type.startsWith('video/')) throw new Error('That URL did not return a video file.');
  return analyzeFile(new File([blob], 'linked-video.mp4', { type }));
}

const SCORE_LABELS: Array<keyof ScoreSet> = ['hook', 'pacing', 'captions', 'audio', 'framing'];

export default function FreeVideoAnalyzer({ onFix }: { onFix: (edit: SuggestedEdit) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);

  useEffect(() => setLimited(usedToday()), []);

  const run = async () => {
    if (limited) return;
    if (mode === 'upload' && !file) { setError('Choose a video file first.'); return; }
    if (mode === 'url' && !url.trim()) { setError('Paste a public video URL first.'); return; }
    setLoading(true);
    setError('');
    setAnalysis(null);
    try {
      const result = mode === 'upload' ? await analyzeFile(file!) : await analyzeUrl(url);
      if (result.overLimit) throw new Error('This analyser accepts videos up to 3 minutes. Trim the video and try again.');
      setAnalysis(result);
      markUsed();
      setLimited(true);
    } catch (reason: any) {
      setError(String(reason?.message || 'The video could not be analysed.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-3xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_94%,transparent)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.38)] sm:p-7" data-testid="free-video-analyzer">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]"><Sparkles className="h-4 w-4" />Free video check</div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--space-text-primary)]">Find what is costing you attention</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--space-text-secondary)]">Upload a video or paste a public link. Get scored feedback on the hook, pacing, captions, audio and framing, plus fixes tied to exact moments.</p>
        </div>
        <span className="rounded-full border border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] px-3 py-1.5 text-[11px] font-semibold text-[var(--space-text-brand)]">1 free check per day · max 3 min</span>
      </div>

      <div className="mt-5 inline-flex rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-1">
        <button type="button" onClick={() => setMode('upload')} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${mode === 'upload' ? 'bg-[var(--space-brand-primary-500)] text-[var(--space-text-on-primary)]' : 'text-[var(--space-text-secondary)]'}`}><Upload className="mr-2 inline h-4 w-4" />Upload</button>
        <button type="button" onClick={() => setMode('url')} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${mode === 'url' ? 'bg-[var(--space-brand-primary-500)] text-[var(--space-text-on-primary)]' : 'text-[var(--space-text-secondary)]'}`}><Link2 className="mr-2 inline h-4 w-4" />Paste URL</button>
      </div>

      {mode === 'upload' ? (
        <div className="mt-4">
          <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(''); setAnalysis(null); }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-24 w-full items-center justify-center rounded-2xl border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] px-4 text-center text-sm text-[var(--space-text-secondary)] hover:border-[var(--space-brand-primary-500)]">
            <Film className="mr-3 h-5 w-5 text-[var(--space-text-brand)]" />{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Choose an MP4, MOV or WebM video'}
          </button>
        </div>
      ) : (
        <input value={url} onChange={(event) => { setUrl(event.target.value); setError(''); setAnalysis(null); }} placeholder="https://youtube.com/watch?v=… or a public MP4 URL" className="mt-4 min-h-11 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-4 text-sm text-[var(--space-text-primary)] outline-none focus:border-[var(--space-brand-primary-500)]" />
      )}

      <button type="button" onClick={() => void run()} disabled={loading || limited} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary-500)] px-4 text-sm font-bold text-[var(--space-text-on-primary)] disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Analysing your video…</> : limited ? 'Free check used today' : 'Analyse my video'}
      </button>

      {error ? <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-3 text-sm text-[var(--space-text-secondary)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-semantic-danger-500)]" /><span><strong className="block text-[var(--space-text-primary)]">The check did not finish</strong>{error}</span></div> : null}

      {analysis ? (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{SCORE_LABELS.map((key) => <div key={key} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-center"><div className="text-2xl font-bold text-[var(--space-text-brand)]">{analysis.scores[key]}</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--space-text-muted)]">{key}</div></div>)}</div>
          <p className="mt-4 rounded-xl bg-[var(--space-surface-panel)] p-4 text-sm leading-6 text-[var(--space-text-secondary)]">{analysis.summary}</p>
          <div className="mt-4 space-y-2">{analysis.edits.map((edit, index) => <article key={`${edit.timestamp}-${index}`} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-4"><div className="flex flex-wrap items-start gap-3"><span className="rounded-full bg-[color-mix(in_srgb,var(--space-brand-primary-500)_14%,transparent)] px-2.5 py-1 text-xs font-bold text-[var(--space-text-brand)]">{edit.timestamp}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--space-text-primary)]">{edit.issue}</p><p className="mt-1 text-xs leading-5 text-[var(--space-text-secondary)]">{edit.fix}</p></div><button type="button" onClick={() => onFix(edit)} className="min-h-11 rounded-xl border border-[var(--space-border-strong)] px-3 text-xs font-bold text-[var(--space-text-brand)] hover:bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent)]">Fix this in Vidverge</button></div></article>)}</div>
          <div className="mt-4 flex items-center gap-2 text-xs text-[var(--space-semantic-success-500)]"><CheckCircle2 className="h-4 w-4" />Your analysis is ready.</div>
        </div>
      ) : null}
    </section>
  );
}
