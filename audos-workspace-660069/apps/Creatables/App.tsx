/**
 * CREATABLES — the unified video generation studio.
 * "All video engines. One place."
 *
 * Every approved engine on the platform, with per-model settings and a smart
 * recommendation engine:
 *   · GROUP A  — 12 models on POST /api/veo/generate/video, polled at
 *     /api/veo/status/:id. The Google routes (Omni Flash and the Veo family)
 *     are the ones confirmed up; Sora and the OpenRouter paths (Seedance 2.0
 *     Fast, OpenRouter Veo) are grouped separately because a refusal there is
 *     re-routed to a Google engine automatically rather than lost.
 *   · RUNWAY   — Gen 4.5 + Gen 4 Turbo base video and the 7 Recipes. Paid
 *     Runway generation is deployment-gated, so availability is probed on
 *     mount and the engine is shown as unavailable BEFORE a wasted click
 *     rather than only after a 503 comes back.
 *   · KLING    — NOT PRESENT on this platform and therefore not listed at all.
 *   · IMAGE LAB — gemini-3.1-flash-image / dall-e-3 / gpt-image-2 companions.
 *
 * Generate submits immediately — there is no quote step, no credit check and
 * no cooldown between pressing the button and the provider call.
 *
 * Every reference-image input carries an AI WRITE button: the picture goes to
 * the OpenAI proxy and comes back as the written brief in the prompt field.
 * VIDEO EXTENSION is a Veo-only switch and is absent for every other engine.
 *
 * The engine catalog, combining rules and recommendation logic live in
 * lib/videoEngines; all network calls live in lib/videoEngineClient.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard, Download, Image as ImageIcon, Layers as LayersIcon, Loader2, Play,
  RefreshCw, Sparkles, Upload, Wand2, X,
} from 'lucide-react';
import {
  FOUR_K_MODELS, GROUP_A_MODELS, GroupAModel, KLING_COMING_SOON_MESSAGE, KLING_MODELS,
  IMAGE_MODELS, PROMPT_BUDGET, RUNWAY_DISABLED_MESSAGE, RUNWAY_RATIOS, RUNWAY_RECIPES,
  RUNWAY_VIDEO_MODELS, RunwayVideoModel, capPromptText, groupAModel, isKlingModel,
  recommendEngine, routeShotIntent, runwayRecipe, runwayVideoModel, tierColor, validateGroupAInputs,
} from '../../lib/videoEngines';
import {
  EngineError, checkRunwayAvailability, isRunwayDisabledError, pollGroupA,
  pollRunway, pollVeoLongVideo, runwaySubmitVideo, submitGroupA,
  submitVeoLongVideo,
} from '../../lib/videoEngineClient';
import { EngineBadge, engineDisplayName } from '../../components/EngineSelector';
import RunwayRecipesPanel from '../../components/RunwayRecipesPanel';
// VidVerge LightBeam UI system — one shared implementation for all six apps.
import {
  Input as BeamInput, LightBeamButton, LightBeamCard, LightBeamError,
  LightBeamProcessing, LightBeamProgress, LightBeamTransition, colors,
} from '../../components/design-system/index';

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

async function uploadDataUrl(dataUrl: string, fileName: string): Promise<string> {
  const res = await fetch('/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
    body: JSON.stringify({ imageData: dataUrl, fileName }),
  });
  const data = await res.json().catch(() => null);
  const url = data && (data.imageUrl || data.url);
  if (!res.ok || typeof url !== 'string') throw new Error(String(data?.error || `Image upload failed (HTTP ${res.status}).`));
  return url;
}

async function uploadFile(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      r.readAsDataURL(file);
    });
    return uploadDataUrl(dataUrl, file.name.replace(/[^\w.-]+/g, '_'));
  }
  const form = new FormData();
  form.append('file', new File([file], file.name.replace(/[^\w.-]+/g, '_'), { type: file.type || 'application/octet-stream' }));
  form.append('folder', 'creatables');
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `File upload failed (HTTP ${res.status}).`));
  return String(data.url);
}

// ---------------------------------------------------------------------------
// AI Write — a reference image read back as the written brief
// ---------------------------------------------------------------------------

const AI_WRITE_SYSTEM = [
  'You write prompts for AI video and image generators.',
  'Answer with ONE prompt and nothing else — no preamble, no bullet points, no quotes, no title.',
  'Stay between 50 and 110 words and cover the subject, the setting, the composition and camera',
  'framing, the lighting, the colour palette, the mood and the overall style, as if directing the',
  'shot that recreates the picture.',
].join(' ');

/**
 * Describe a reference image as a generation prompt through the OpenAI proxy.
 * An uploaded file has already become an https URL by the time it reaches
 * here, but a base64 data URL travels in exactly the same `image_url` part.
 */
async function describeImageAsPrompt(imageUrl: string): Promise<string> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 600,
      stream: false,
      messages: [
        { role: 'system', content: AI_WRITE_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this reference image as a single generation prompt.' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code ? ` [${data.code}]` : '';
    const reported = String(data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || '');
    throw new Error(`${reported || `AI Write could not read this image (HTTP ${res.status}).`}${code}`);
  }
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('AI Write came back empty — try it again.');
  return capPromptText(text, 1000);
}

// ---------------------------------------------------------------------------
// History (last 10 generations, localStorage)
// ---------------------------------------------------------------------------

interface HistoryItem {
  id: string;
  at: number;
  engine: string;
  engineName: string;
  prompt: string;
  url: string;
  kind: 'video' | 'image';
  cost?: string;
  seconds?: number;
}

const HISTORY_KEY = 'creatables_history_v1';

function loadHistory(): HistoryItem[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(HISTORY_KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 10) : [];
  } catch { return []; }
}

function pushHistory(item: HistoryItem): HistoryItem[] {
  const next = [item, ...loadHistory()].slice(0, 10);
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}

// ---------------------------------------------------------------------------
// Server-adopted job rows (creatables_jobs). The DB row is the durable record
// of a run: the browser submits the render, INSERTS a row with the operation
// id, hands polling to the creatables-worker server function, and then only
// READS the row on a simple 5-second interval — no long-lived connection, no
// client-side provider polling, and the tab can close while the render
// finishes. Staggered cron sweeps adopt any run whose poll chain died.
// ---------------------------------------------------------------------------

interface JobRow {
  id: number;
  engine: string | null;
  engine_name: string | null;
  prompt: string | null;
  status: 'pending' | 'running' | 'done' | 'error' | null;
  operation_id: string | null;
  result_url: string | null;
  error_msg: string | null;
  cost: string | null;
  eta: string | null;
  fallback_note: string | null;
  started_at: string | null;
  created_at: string;
}

function wdb(): any | null {
  return typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
}

function wsToken(): string {
  return String(wdb()?.token || '');
}

function formatCost(value: string | undefined): string {
  const raw = String(value || '').trim();
  return !raw || raw.startsWith('$') ? raw : `$${raw}`;
}

async function insertJobRow(row: Partial<JobRow>): Promise<JobRow | null> {
  try {
    const res = await wdb()?.from('creatables_jobs').insert(row);
    return (res?.data?.[0] || res?.data || null) as JobRow | null;
  } catch { return null; }
}

async function readJobRow(id: number): Promise<JobRow | null> {
  try {
    const res = await wdb()?.from('creatables_jobs').getById(id);
    return (res?.data as JobRow) || null;
  } catch { return null; }
}

async function listMyJobs(limit = 12): Promise<JobRow[]> {
  try {
    const res = await wdb()?.from('creatables_jobs').orderBy('created_at', 'desc').limit(limit).get();
    return Array.isArray(res?.data) ? res.data : [];
  } catch { return []; }
}

/** Hand a submitted render's polling to the creatables-worker server function
 * (fire-and-forget — the cron sweeps cover a dropped dispatch). */
function handPollingToServer(jobId: number) {
  fetch(`/api/hooks/execute/${appId()}/creatables-worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}) },
    body: JSON.stringify({ op: 'watch', job_id: jobId, source: 'app' }),
  }).catch(() => undefined);
}

/** Simple-interval DB read until the job settles. The server enforces its own
 * 15-minute no-progress cap, so a row always reaches done/error; the 25-minute
 * client ceiling only guards against reading a row nothing is advancing. */
async function watchJobRow(jobId: number, opts: { onTick?: (row: JobRow) => void; isCancelled?: () => boolean } = {}): Promise<JobRow> {
  const deadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) throw new EngineError('This generation was cancelled.', { code: 'cancelled' });
    const row = await readJobRow(jobId);
    if (row) {
      opts.onTick?.(row);
      if (row.status === 'done' && row.result_url) return row;
      if (row.status === 'error') throw new EngineError(row.error_msg || 'The render failed.', { code: 'render_failed' });
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new EngineError('The render took too long. Start it again to retry.', { code: 'timeout' });
}

// ---------------------------------------------------------------------------
// Small UI atoms (space theme tokens with dark fallbacks)
// ---------------------------------------------------------------------------

const T = {
  ink: 'var(--space-text-primary, #F0F0F0)',
  soft: 'var(--space-text-secondary, rgba(240,240,240,0.62))',
  muted: 'var(--space-text-muted, rgba(240,240,240,0.38))',
  card: 'var(--space-surface-card, #0F0F0F)',
  panel: 'var(--space-surface-panel, #101010)',
  raised: 'var(--space-surface-panel-strong, #141414)',
  line: 'var(--space-border-default, rgba(255,255,255,0.06))',
  accent: 'var(--space-brand-primary-500, #F5B936)',
  accentDeep: 'var(--space-brand-primary-600, #E0A527)',
  good: 'var(--space-semantic-success-600, #4ADE80)',
  bad: 'var(--space-semantic-danger, #F87171)',
  warn: '#F5B936',
} as const;

const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: T.muted, display: 'block', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: T.panel, border: `1px solid ${T.line}`, borderRadius: 9, color: T.ink, fontSize: 13, padding: '9px 11px', outline: 'none' };
const chip = (active: boolean): React.CSSProperties => ({ background: active ? T.accentDeep : T.raised, color: active ? '#fff' : T.soft, border: `1px solid ${active ? 'transparent' : T.line}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' });

/** The AI Write action for one reference image — fills the brief from the
 * picture. Renders nothing until an image exists to read. */
function AiWriteButton({ imageUrl, onWrite, target = 'prompt' }: {
  imageUrl: string;
  onWrite: (prompt: string) => void;
  target?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!imageUrl) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <LightBeamButton
        small
        kind="ghost"
        busy={busy}
        title={`Describe this image into the ${target} field`}
        onClick={() => {
          if (busy) return;
          setBusy(true); setErr('');
          describeImageAsPrompt(imageUrl)
            .then(onWrite)
            .catch((e: any) => setErr(String(e?.message || e)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} color={T.warn} />}
        {busy ? 'Reading the image…' : 'AI Write'}
      </LightBeamButton>
      <div style={{ fontSize: 10.5, color: T.muted, marginTop: 5, lineHeight: 1.4 }}>
        Writes the {target} from this image.
      </div>
      {err ? <div style={{ fontSize: 11, color: T.bad, marginTop: 5 }}>{err}</div> : null}
    </div>
  );
}

function UploadZone({ title, hint, urls, max, onChange, extra, aiWrite }: {
  title: string; hint?: string; urls: string[]; max: number;
  onChange: (urls: string[]) => void;
  extra?: (url: string, idx: number) => React.ReactNode;
  /** Turns the first image in this zone into the written brief. */
  aiWrite?: { onWrite: (prompt: string) => void; target?: string };
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div>
      <span style={label}>{title}{max > 1 ? ` (${urls.length}/${max})` : ''}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {urls.map((u, i) => (
          <div key={u} style={{ position: 'relative' }}>
            <img src={u} alt="" style={{ width: 86, height: 58, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.line}` }} />
            <button type="button" onClick={() => onChange(urls.filter((x) => x !== u))} style={{ position: 'absolute', top: -6, right: -6, width: 17, height: 17, borderRadius: 999, border: 'none', background: '#EF4444', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={10} /></button>
            {extra ? extra(u, i) : null}
          </div>
        ))}
        {urls.length < max ? (
          <button type="button" disabled={busy} onClick={() => ref.current?.click()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, width: 86, height: 58, background: T.panel, border: `1px dashed ${T.line}`, borderRadius: 8, color: T.muted, fontSize: 10.5, cursor: 'pointer' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
          </button>
        ) : null}
      </div>
      {hint ? <div style={{ fontSize: 10.5, color: T.muted, marginTop: 5, lineHeight: 1.4 }}>{hint}</div> : null}
      {aiWrite ? <AiWriteButton imageUrl={urls[0] || ''} onWrite={aiWrite.onWrite} target={aiWrite.target} /> : null}
      {err ? <div style={{ fontSize: 11, color: T.bad, marginTop: 5 }}>{err}</div> : null}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true); setErr('');
        try { onChange([...urls, await uploadFile(f)].slice(0, max)); }
        catch (ex: any) { setErr(String(ex?.message || ex)); }
        finally { setBusy(false); e.target.value = ''; }
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

type Tab = 'video' | 'recipes' | 'image';
type RunPhase = 'idle' | 'running' | 'done' | 'error';

export default function App() {
  const [tab, setTab] = useState<Tab>('video');

  // ---- brief ----
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [engineId, setEngineId] = useState('veo-3.1-fast-generate-preview');
  const [engineMode, setEngineMode] = useState<'auto' | 'manual'>('auto');
  const [recommended, setRecommended] = useState<{ engineId: string; reason: string; caveat?: string } | null>(null);

  // ---- Group A settings ----
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [audio, setAudio] = useState(false);
  const [videoExtension, setVideoExtension] = useState(false);
  const [seedUrl, setSeedUrl] = useState<string[]>([]);
  const [lastFrameUrl, setLastFrameUrl] = useState<string[]>([]);
  const [refs, setRefs] = useState<{ url: string; type: 'asset' | 'style' }[]>([]);

  // ---- Runway base settings ----
  const [rwRatio, setRwRatio] = useState('1280:720');
  const [rwDuration, setRwDuration] = useState(5);
  const [rwImage, setRwImage] = useState<string[]>([]);
  const [runwayDown, setRunwayDown] = useState(false);
  // Runway's paid generation is deployment-gated, so it is probed once on
  // mount. Knowing up front beats letting the user fill in a brief, press
  // Generate and only then be told the provider is switched off.
  const [runwayGate, setRunwayGate] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  // ---- run state ----
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(0);
  const [opId, setOpId] = useState('');
  const [eta, setEta] = useState('');
  const [cost, setCost] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [error, setError] = useState('');
  const [fallbackNote, setFallbackNote] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedS, setElapsedS] = useState(0);
  const cancelled = useRef(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  useEffect(() => { setHistory(loadHistory()); }, []);
  useEffect(() => {
    let live = true;
    void checkRunwayAvailability()
      .then((gate) => { if (live) { setRunwayGate(gate.available ? 'ready' : 'unavailable'); setRunwayDown(!gate.available); } })
      .catch(() => { if (live) { setRunwayGate('unavailable'); setRunwayDown(true); } });
    return () => { live = false; };
  }, []);
  // RESUME: the creatables_jobs row is the durable record of a run. On mount,
  // merge finished server-adopted jobs the local history missed, and re-attach
  // the run panel to a render that is still running server-side (submitted
  // before a reload or in a tab that closed mid-render).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    (async () => {
      const rows = await listMyJobs(12);
      if (!rows.length) return;
      const seen = loadHistory();
      const known = new Set(seen.map((h) => h.id));
      const knownUrls = new Set(seen.map((h) => h.url));
      for (const r of [...rows].reverse()) {
        if (r.status === 'done' && r.result_url && !known.has(`job_${r.id}`) && !knownUrls.has(r.result_url)) {
          setHistory(pushHistory({ id: `job_${r.id}`, at: new Date(r.created_at).getTime(), engine: String(r.engine || ''), engineName: String(r.engine_name || r.engine || ''), prompt: String(r.prompt || ''), url: String(r.result_url), kind: 'video', cost: r.cost || undefined }));
        }
      }
      const running = rows.find((r) => r.status === 'running');
      if (!running?.id) return;
      cancelled.current = false;
      setPhase('running'); setError(''); setOutputUrl('');
      setOpId(String(running.operation_id || ''));
      if (running.cost) setCost(String(running.cost));
      if (running.fallback_note) setFallbackNote(String(running.fallback_note));
      const startedMs = new Date(running.started_at || running.created_at).getTime();
      setStartedAt(startedMs); setElapsedS(Math.round((Date.now() - startedMs) / 1000));
      setNote(`Rendering on ${running.engine_name || running.engine}… resumed — the server kept watching while this tab was away`);
      setProgress(24);
      handPollingToServer(running.id);
      try {
        const done = await watchJobRow(running.id, { onTick: () => setProgress((p) => Math.min(96, Math.max(24, p + 1.5))), isCancelled: () => cancelled.current });
        setOutputUrl(String(done.result_url || '')); setProgress(100); setPhase('done'); setNote('Done.');
        if (done.result_url && !knownUrls.has(done.result_url)) {
          setHistory(pushHistory({ id: `job_${done.id}`, at: Date.now(), engine: String(done.engine || ''), engineName: String(done.engine_name || done.engine || ''), prompt: String(done.prompt || ''), url: String(done.result_url), kind: 'video', cost: done.cost || undefined }));
        }
      } catch (e: any) {
        if (e instanceof EngineError && e.code === 'cancelled') { setPhase('idle'); return; }
        setPhase('error'); setError(String(e?.message || e));
      }
    })();
  }, []);
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => setElapsedS(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  const motionImage = seedUrl[0] || rwImage[0] || '';
  const autoIntent = motionImage ? 'stills_to_motion' : 'cinematic_hero';
  const autoRoute = routeShotIntent(autoIntent, { runwayEnabled: runwayGate === 'ready' });
  const activeEngineId = engineMode === 'auto'
    ? (autoRoute.engineId || 'veo-3.1-fast-generate-preview')
    : engineId;
  const gA = groupAModel(activeEngineId);
  const rw = runwayVideoModel(activeEngineId);
  const kling = isKlingModel(activeEngineId);
  const recipeSel = runwayRecipe(activeEngineId);
  const promptOk = prompt.trim().length >= 10;
  // Video Extension is a Veo control: every Veo path — Google-native and the
  // OpenRouter ones — carries "veo" in its model id, and nothing else does.
  const isVeoEngine = /veo/i.test(activeEngineId);
  const videoExtensionOn = Boolean(gA && isVeoEngine && videoExtension);

  // Runway settings depend on mode: image-to-video unlocks the extra ratios.
  const rwRatios = useMemo(() => {
    if (!rw) return RUNWAY_RATIOS;
    const allowed = motionImage || !rw.textToVideo ? rw.i2vRatios : rw.t2vRatios;
    return RUNWAY_RATIOS.filter((r) => allowed.includes(r.value));
  }, [rw, motionImage]);
  useEffect(() => {
    if (rw && !rwRatios.some((r) => r.value === rwRatio) && rwRatios[0]) setRwRatio(rwRatios[0].value);
  }, [rw, rwRatios, rwRatio]);

  const baseCombineViolation = gA ? validateGroupAInputs(activeEngineId, {
    prompt,
    imageData: seedUrl[0] || null,
    referenceImages: refs.length ? refs : null,
    lastFrameImage: lastFrameUrl[0] ? { imageData: lastFrameUrl[0] } : null,
  }) : null;
  const extensionViolation = videoExtensionOn
    ? refs.length > 0
      ? 'Video Extension uses Veo’s long-video continuity route, which supports a seed image but not reference images.'
      : aspect === '1:1'
        ? 'Video Extension supports 16:9 or 9:16 output.'
        : null
    : null;
  const combineViolation = baseCombineViolation || extensionViolation;

  const canGenerate = promptOk && !kling && phase !== 'running' && (
    gA ? !combineViolation
      : rw ? runwayGate === 'ready' && (rw.textToVideo || Boolean(motionImage))
        : false
  );

  function pickEngine(id: string) {
    setEngineId(id);
    setEngineMode('manual');
    if (runwayRecipe(id)) setTab('recipes');
  }

  function runRecommend() {
    const rec = recommendEngine({
      prompt,
      hasCharacterImage: refs.length > 0 || /face|character|person|me\b/i.test(prompt),
      hasProductImages: rwImage.length > 0 || seedUrl.length > 0,
      imageCount: seedUrl.length + refs.length + rwImage.length,
      durationS: duration,
      runwayUnavailable: runwayDown,
    });
    setRecommended({ engineId: rec.engineId, reason: rec.reason, caveat: rec.caveat });
    pickEngine(rec.engineId);
  }

  /** Runway uses pixel-pair ratios; the Group A engines use plain labels. */
  function rwRatioToAspect(ratio: string): '16:9' | '9:16' | '1:1' {
    const [w, h] = ratio.split(':').map(Number);
    if (!w || !h || w === h) return '1:1';
    return w > h ? '16:9' : '9:16';
  }

  function buildRunwayBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { model: rw!.id, ratio: rwRatio, duration: rwDuration };
    if (rw!.id === 'gen4.5') {
      body.promptText = prompt.trim();
      if (motionImage) { body.mode = 'image-to-video'; body.promptImage = motionImage; }
    } else {
      // gen4_turbo — image-to-video only; promptImage as positioned frame array.
      body.promptImage = [{ uri: motionImage, position: 'first' }];
      if (prompt.trim()) body.promptText = prompt.trim();
    }
    return body;
  }

  /** Persist a submitted render as a creatables_jobs row, hand polling to the
   * creatables-worker server function, then just READ the row every 5s. Falls
   * back to the legacy in-browser provider poll only when the workspace data
   * runtime is unavailable, so a run always lands one way or the other. */
  async function settleThroughJobRow(args: { engine: string; engineName: string; operationId: string; cost?: string; eta?: string; fallbackNote?: string; longVideo?: boolean }): Promise<string> {
    const row = await insertJobRow({
      engine: args.longVideo ? `long-video:${args.engine}` : args.engine,
      engine_name: args.engineName, prompt: prompt.slice(0, 500), kind: 'video',
      status: 'running', operation_id: args.operationId, cost: args.cost || null, eta: args.eta || null,
      fallback_note: args.fallbackNote || null, started_at: new Date().toISOString(),
    });
    if (!row?.id) {
      const poll = args.longVideo ? pollVeoLongVideo : pollGroupA;
      return poll(args.operationId, {
        onProgress: (p) => setProgress(Math.max(12, Math.min(96, p))),
        isCancelled: () => cancelled.current,
      });
    }
    handPollingToServer(row.id);
    const done = await watchJobRow(row.id, {
      onTick: () => setProgress((p) => Math.min(96, Math.max(12, p + 1.5))),
      isCancelled: () => cancelled.current,
    });
    return String(done.result_url || '');
  }

  async function generate() {
    if (!canGenerate) return;
    cancelled.current = false;
    setPhase('running'); setError(''); setFallbackNote(''); setOutputUrl(''); setNote('Submitting…'); setProgress(4);
    setOpId(''); setEta(''); setCost(''); setStartedAt(Date.now()); setElapsedS(0);
    let ranOn = gA?.name || rw?.name || activeEngineId;
    try {
      let url = '';
      if (gA) {
        const sharedVeoParams = {
          model: activeEngineId,
          prompt,
          negativePrompt: negative || undefined,
          duration,
          generateAudio: gA.supportsAudio ? audio : false,
          resolution: gA.supports4k ? resolution : (resolution === '4k' ? '1080p' as const : resolution),
          imageData: seedUrl[0] || undefined,
          lastFrameImage: lastFrameUrl[0] ? { imageData: lastFrameUrl[0] } : undefined,
        };
        const kick = videoExtensionOn
          ? await submitVeoLongVideo({
              ...sharedVeoParams,
              aspectRatio: aspect === '1:1' ? '16:9' : aspect,
            })
          : await submitGroupA({
              ...sharedVeoParams,
              aspectRatio: aspect,
              referenceImages: refs.length ? refs.map((r) => ({ imageData: r.url, referenceType: r.type })) : undefined,
            });
        setOpId(kick.operationId);
        if (kick.cost) setCost(formatCost(kick.cost));
        if (kick.estimatedDuration) setEta(kick.estimatedDuration);
        ranOn = `${groupAModel(kick.modelUsed)?.name || kick.modelUsed}${videoExtensionOn ? ' · Video Extension' : ''}`;
        if (kick.fallbackFrom) {
          setFallbackNote(`${gA.name} refused this job, so it is rendering on ${ranOn} instead. ${kick.fallbackReason || ''}`.trim());
        }
        setNote(`Rendering on ${ranOn}… the server is watching this render — you can close this tab`);
        setProgress(12);
        url = await settleThroughJobRow({
          engine: kick.modelUsed || activeEngineId,
          engineName: ranOn,
          operationId: kick.operationId,
          cost: kick.cost ? formatCost(kick.cost) : '',
          eta: kick.estimatedDuration || '',
          fallbackNote: kick.fallbackFrom ? `${gA.name} refused this job — re-routed to ${ranOn}.` : '',
          longVideo: videoExtensionOn,
        });
      } else if (rw) {
        let taskId = '';
        try {
          const kick = await runwaySubmitVideo(buildRunwayBody());
          if (kick.uncertain) throw new EngineError('Runway accepted the request but the outcome is uncertain — do NOT resubmit; check back shortly.', { code: 'runway_uncertain' });
          taskId = kick.taskId;
          setOpId(kick.taskId);
          setNote(`Runway task ${kick.status}… polling every 5s`);
        } catch (e: any) {
          // 503 "being enabled" and an uncertain outcome both have their own
          // handling; anything else means Runway would not take the job, so
          // re-route it rather than leave the user with nothing.
          if (isRunwayDisabledError(e) || (e instanceof EngineError && e.code === 'runway_uncertain')) throw e;
          const alt = 'gemini-omni-flash-preview';
          setFallbackNote(`${rw.name} could not take this job, so it is rendering on ${groupAModel(alt)?.name || alt} instead. ${String(e?.message || e)}`);
          setNote('Re-routing to an engine that is accepting jobs…');
          const kick = await submitGroupA({
            model: alt,
            prompt,
            negativePrompt: negative || undefined,
            aspectRatio: rwRatioToAspect(rwRatio),
            duration: Math.max(4, Math.min(8, rwDuration)),
            generateAudio: false,
            imageData: rwImage[0] || undefined,
          });
          ranOn = groupAModel(kick.modelUsed)?.name || kick.modelUsed;
          setOpId(kick.operationId);
          if (kick.cost) setCost(formatCost(kick.cost));
          setNote(`Rendering on ${ranOn}… the server is watching this render — you can close this tab`);
          setProgress(12);
          url = await settleThroughJobRow({
            engine: 'gemini-omni-flash-preview',
            engineName: ranOn,
            operationId: kick.operationId,
            cost: kick.cost ? formatCost(kick.cost) : '',
            fallbackNote: `${rw.name} could not take this job — re-routed to ${ranOn}.`,
          });
        }
        if (taskId) {
          setProgress(12);
          const result = await pollRunway(taskId, {
            onStatus: (s) => { setNote(`Runway — ${s}…`); setProgress((p) => Math.min(94, p + 4)); },
            isCancelled: () => cancelled.current,
          });
          url = result.mediaUrls[0] || '';
          setCost(`$${(rw.pricePerSecondUsd * rwDuration).toFixed(2)}`);
          if (!url) throw new EngineError('Runway succeeded but returned no media URL.', { code: 'no_media' });
        }
      }
      setOutputUrl(url);
      setProgress(100);
      setPhase('done');
      setNote('Done.');
      setHistory(pushHistory({
        id: `h_${Date.now()}`, at: Date.now(), engine: activeEngineId,
        engineName: ranOn, prompt: prompt.slice(0, 220),
        url, kind: 'video', cost: cost || undefined, seconds: Math.round((Date.now() - startedAt) / 1000),
      }));
    } catch (e: any) {
      if (isRunwayDisabledError(e)) {
        setRunwayDown(true);
        setPhase('idle');
        setError(RUNWAY_DISABLED_MESSAGE);
        return;
      }
      setPhase('error');
      setError(String(e?.message || e));
    }
  }

  // ------------------------------------------------------------------ UI ----
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--space-surface-bg, #0A0F1E)', color: T.ink, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '26px 22px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span style={{ display: 'flex', width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, background: T.accentDeep }}><Clapperboard size={19} color="#fff" /></span>
          <div>
            <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: -0.4 }}>Creatables</div>
            <div style={{ fontSize: 12.5, color: T.muted }}>All video engines. One place.</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {([['video', 'Video Studio', Clapperboard], ['recipes', 'Runway Recipes', LayersIcon], ['image', 'Image Lab', ImageIcon]] as const).map(([id, name, Icon]) => (
              <LightBeamButton key={id} small kind={tab === id ? 'primary' : 'ghost'} onClick={() => setTab(id as Tab)}><Icon size={13} /> {name}</LightBeamButton>
            ))}
          </div>
        </div>

        <LightBeamTransition routeKey={tab}>
        {tab === 'recipes' ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12.5, color: T.soft, marginBottom: 10 }}>Seven Runway production recipes — a 503 simply means Runway is still being enabled on the platform.</div>
            <RunwayRecipesPanel uploadFile={uploadFile} initialRecipe={recipeSel?.id} />
          </div>
        ) : tab === 'image' ? (
          <ImageLab />
        ) : (
          <>
            {/* Prompt */}
            <div style={{ marginTop: 18 }}>
              <BeamInput
                value={prompt}
                onChange={setPrompt}
                rows={Math.min(8, Math.max(3, prompt.split('\n').length + 1))}
                placeholder='Describe your video — subject, action, setting, camera, mood. The more specific, the better the result.'
                inputStyle={{ fontSize: 14.5, lineHeight: 1.55 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
                <span style={{ fontSize: 11, color: promptOk ? T.muted : T.warn }}>{prompt.trim().length} / {PROMPT_BUDGET} characters{promptOk ? '' : ' — at least 10 needed'}</span>
                <button type="button" onClick={runRecommend} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${T.line}`, borderRadius: 9, color: T.ink, fontSize: 12, fontWeight: 700, padding: '6px 12px', cursor: 'pointer' }}>
                  <Sparkles size={13} color={T.warn} /> Recommend for me
                </button>
              </div>
              {recommended ? (
                <div style={{ marginTop: 8, fontSize: 12, color: T.soft, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 9, padding: '8px 12px' }}>
                  <b style={{ color: T.warn }}>Recommended:</b> {recommended.reason}{recommended.caveat ? <span style={{ color: T.muted }}> · {recommended.caveat}</span> : null}
                </div>
              ) : null}
            </div>

            {/* Auto Director + existing manual engine grid */}
            <div style={{ marginTop: 22 }}>
              <span style={label}>Engine</span>
              <button type="button" onClick={() => setEngineMode('auto')} style={{ ...chip(engineMode === 'auto'), marginBottom: 9 }}>
                Auto — Director picks
              </button>
              {engineMode === 'auto' ? (
                <div style={{ marginBottom: 10, fontSize: 12, color: T.soft, background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 13px', lineHeight: 1.55 }}>
                  <b style={{ color: T.ink }}>Director's pick: {engineDisplayName(activeEngineId)}</b>
                  <div style={{ color: T.muted, marginTop: 3 }}>{autoRoute.reason}</div>
                </div>
              ) : (
                <div style={{ marginBottom: 9, fontSize: 11.5, color: T.muted }}>Manual override — the selected concrete model is submitted.</div>
              )}
              <EngineGrid selected={activeEngineId} recommendedId={recommended?.engineId || null} onPick={pickEngine} runwayGate={runwayGate} />
            </div>

            {/* Per-model settings */}
            <div style={{ marginTop: 20, background: T.card, border: `1px solid ${T.line}`, borderRadius: 13, padding: 16 }}>
              {kling ? (
                <div style={{ fontSize: 13, color: T.soft, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <EngineBadge tier="Coming Soon" /> {KLING_COMING_SOON_MESSAGE}
                </div>
              ) : gA ? (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <span style={label}>Aspect ratio</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(['16:9', '9:16', '1:1'] as const).map((a) => (
                          <button key={a} type="button" onClick={() => setAspect(a)} style={chip(aspect === a)}>{a}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span style={label}>Duration: {duration}s (normalized to the model's supported lengths)</span>
                      <input type="range" min={4} max={Math.max(8, gA.maxDurationS)} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: 200, accentColor: T.accent }} />
                    </div>
                    <div>
                      <span style={label}>Resolution{gA.supports4k ? ' (4K available)' : ''}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(['720p', '1080p'] as const).map((r) => (
                          <button key={r} type="button" onClick={() => setResolution(r)} style={chip(resolution === r)}>{r}</button>
                        ))}
                        {FOUR_K_MODELS.includes(activeEngineId) ? (
                          <button type="button" onClick={() => setResolution('4k')} style={chip(resolution === '4k')}>4K</button>
                        ) : null}
                      </div>
                    </div>
                    {gA.supportsAudio ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: T.soft, cursor: 'pointer', paddingBottom: 6 }}>
                        <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Generate audio
                      </label>
                    ) : null}
                    {isVeoEngine ? (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer', paddingBottom: 6 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: T.soft }}>
                          <input type="checkbox" checked={videoExtension} onChange={(e) => setVideoExtension(e.target.checked)} /> Video Extension
                        </span>
                        <span style={{ fontSize: 11, color: T.muted, paddingLeft: 24 }}>Extends clip duration using Veo</span>
                      </label>
                    ) : null}
                  </div>

                  <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                    <UploadZone title="Seed image (image-to-video)" hint="The opening frame. Optional." urls={seedUrl} max={1} onChange={setSeedUrl} aiWrite={{ onWrite: setPrompt }} />
                    {gA.supportsReferenceImages ? (
                      <UploadZone
                        title="Reference images"
                        hint={gA.refsExclusiveWithSeed ? 'Up to 3. On this model refs are EXCLUSIVE with seed/last frame.' : 'Up to 3 — keeps the same character/product across scenes. May combine with a seed image.'}
                        urls={refs.map((r) => r.url)} max={3}
                        onChange={(urls) => setRefs(urls.map((u) => refs.find((r) => r.url === u) || { url: u, type: 'asset' }))}
                        aiWrite={{ onWrite: setPrompt }}
                        extra={(u) => {
                          const r = refs.find((x) => x.url === u);
                          if (!r) return null;
                          return (
                            <button type="button" onClick={() => setRefs(refs.map((x) => x.url === u ? { ...x, type: x.type === 'asset' ? 'style' : 'asset' } : x))}
                              style={{ position: 'absolute', left: 3, bottom: 3, border: 'none', borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 800, cursor: 'pointer', background: r.type === 'asset' ? T.accentDeep : '#7C3AED', color: '#fff' }}>
                              {r.type}
                            </button>
                          );
                        }}
                      />
                    ) : null}
                    {gA.supportsLastFrame && seedUrl.length > 0 ? (
                      <UploadZone title="Last frame (locks the ending)" hint="First/last-frame flow: seed opens the clip, this frame closes it." urls={lastFrameUrl} max={1} onChange={setLastFrameUrl} aiWrite={{ onWrite: setPrompt }} />
                    ) : null}
                  </div>

                  <div>
                    <span style={label}>Negative prompt (optional)</span>
                    <input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="Things that must NOT appear — e.g. on-screen text, watermarks, logos" style={inputStyle} />
                  </div>

                  {combineViolation && (videoExtensionOn || seedUrl.length || refs.length || lastFrameUrl.length) ? (
                    <div style={{ fontSize: 12, color: T.warn, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 9, padding: '8px 12px' }}>{combineViolation}</div>
                  ) : null}

                  <div style={{ fontSize: 12, color: T.muted }}>Estimated cost: <b style={{ color: T.soft }}>{gA.costHint}{videoExtensionOn ? ' × 2 clips' : ''}</b> — the exact charge is reported when the render starts.</div>
                </div>
              ) : rw ? (
                <div style={{ display: 'grid', gap: 16 }}>
                  {runwayGate === 'checking' ? <div style={{ fontSize: 12.5, color: T.soft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 9, padding: '8px 12px' }}>Checking whether Runway is enabled…</div> : null}
                  {runwayGate === 'unavailable' ? <div style={{ fontSize: 12.5, color: T.warn, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 9, padding: '8px 12px' }}>{RUNWAY_DISABLED_MESSAGE} Pick Omni Flash or a Veo engine to generate now.</div> : null}
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <span style={label}>Ratio (Runway pixel-pair)</span>
                      <select value={rwRatio} onChange={(e) => setRwRatio(e.target.value)} style={{ ...inputStyle, width: 250, cursor: 'pointer' }}>
                        {rwRatios.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <span style={label}>Duration: {rwDuration}s (2–10 · ${(rw.pricePerSecondUsd * rwDuration).toFixed(2)} at ${rw.pricePerSecondUsd.toFixed(2)}/s)</span>
                      <input type="range" min={rw.minDurationS} max={rw.maxDurationS} value={rwDuration} onChange={(e) => setRwDuration(Number(e.target.value))} style={{ width: 200, accentColor: T.accent }} />
                    </div>
                  </div>
                  <UploadZone
                    title={rw.textToVideo ? 'Prompt image (optional — switches to image-to-video)' : 'Prompt image (REQUIRED — Gen 4 Turbo is image-to-video only)'}
                    hint="Must resolve to a public HTTPS URL — uploads here are stored durably and qualify."
                    urls={motionImage ? [motionImage] : []} max={1} onChange={(urls) => { setRwImage(urls); setSeedUrl(urls); }}
                    aiWrite={{ onWrite: setPrompt }}
                  />
                </div>
              ) : recipeSel ? (
                <div style={{ fontSize: 12.5, color: T.soft }}>Recipe engines run from the <b>Runway Recipes</b> tab — it just opened for you.</div>
              ) : null}
            </div>

            {/* Generate */}
            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <LightBeamButton
                disabled={!canGenerate}
                busy={phase === 'running'}
                onClick={() => void generate()}
              >
                <Wand2 size={16} />
                {phase === 'running' ? 'Generating…' : 'Generate video'}
              </LightBeamButton>
              {phase === 'running' ? (
                <button type="button" onClick={() => { cancelled.current = true; }} style={{ ...chip(false) }}>Stop watching</button>
              ) : null}
              {!promptOk ? <span style={{ fontSize: 12, color: T.muted }}>Write at least 10 characters to unlock Generate.</span>
                : kling ? <span style={{ fontSize: 12, color: T.muted }}>{KLING_COMING_SOON_MESSAGE}</span>
                : rw && runwayGate === 'unavailable' ? <span style={{ fontSize: 12, color: T.warn }}>{RUNWAY_DISABLED_MESSAGE}</span>
                : rw && runwayGate === 'checking' ? <span style={{ fontSize: 12, color: T.muted }}>Checking whether Runway is enabled…</span>
                : rw && !rw.textToVideo && !motionImage ? <span style={{ fontSize: 12, color: T.warn }}>{rw.name} is image-to-video only — upload a prompt image.</span>
                : gA && combineViolation && (videoExtensionOn || seedUrl.length || refs.length || lastFrameUrl.length) ? <span style={{ fontSize: 12, color: T.warn }}>{combineViolation}</span>
                : null}
            </div>

            {/* Progress */}
            {phase === 'running' ? (
              <div style={{ marginTop: 16, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 15 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: T.soft, marginBottom: 12 }}>
                  <span>{note}</span>
                  <span style={{ color: T.muted }}>{elapsedS}s elapsed{eta ? ` · est. ${eta}` : ''}</span>
                </div>
                <LightBeamProcessing progress={progress} rows={4} />
                <LightBeamProgress progress={progress} showValue={false} style={{ marginTop: 12 }} />
                {opId ? <div style={{ fontSize: 10.5, color: T.muted, marginTop: 7, fontFamily: 'monospace' }}>operation: {opId}{cost ? ` · cost: ${cost}` : ''}</div> : null}
              </div>
            ) : null}

            {fallbackNote ? (
              <div style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.55, color: T.warn, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 10, padding: '10px 14px' }}>
                {fallbackNote}
              </div>
            ) : null}

            {error ? (
              <LightBeamError
                runKey={error}
                style={{ marginTop: 14 }}
                message={(
                  <>
                    {error}
                    {phase === 'error' && (error.includes('502') || /safe to retry/i.test(error)) ? (
                      <button type='button' onClick={() => void generate()} style={{ ...chip(false), marginLeft: 10, padding: '4px 10px', fontSize: 11.5 }}><RefreshCw size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Retry</button>
                    ) : null}
                  </>
                )}
              />
            ) : null}

            {/* Output */}
            {phase === 'done' && outputUrl ? (
              <div style={{ marginTop: 18, background: T.card, border: `1px solid ${T.line}`, borderRadius: 13, padding: 15 }}>
                <video src={outputUrl} controls autoPlay style={{ width: '100%', maxHeight: 460, borderRadius: 10, background: '#000' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
                  <a href={outputUrl} target="_blank" rel="noreferrer" download style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.accentDeep, color: '#fff', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                    <Download size={14} /> Download
                  </a>
                  <span style={{ fontSize: 12, color: T.muted }}>
                    {(gA?.name || rw?.name || activeEngineId)} · {elapsedS}s generation time{cost ? ` · ${cost}` : ''}
                  </span>
                </div>
              </div>
            ) : null}

            {/* History */}
            {history.length > 0 ? (
              <div style={{ marginTop: 30 }}>
                <span style={label}>Recent generations (last 10, this browser)</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
                  {history.map((h) => (
                    <div key={h.id} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
                      {h.kind === 'video'
                        ? <video src={h.url} muted preload="metadata" style={{ width: '100%', height: 104, objectFit: 'cover', background: '#000', display: 'block' }} />
                        : <img src={h.url} alt="" style={{ width: '100%', height: 104, objectFit: 'cover', display: 'block' }} />}
                      <div style={{ padding: '7px 9px' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.soft }}>{h.engineName}</div>
                        <div style={{ fontSize: 10, color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={h.prompt}>{h.prompt}</div>
                        <a href={h.url} target="_blank" rel="noreferrer" download style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--space-text-brand, #60A5FA)', textDecoration: 'none' }}>Download</a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
        </LightBeamTransition>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine card grid — grouped by provider
// ---------------------------------------------------------------------------

/** Google routes confirmed up on this platform — the engines to reach for. */
const GOOGLE_UP_IDS = [
  'gemini-omni-flash-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.0-generate-001',
  'veo-3.0-fast-generate-001',
  'veo-2.0-generate-001',
];

function EngineGrid({ selected, recommendedId, onPick, runwayGate }: {
  selected: string;
  recommendedId: string | null;
  onPick: (id: string) => void;
  runwayGate: 'checking' | 'ready' | 'unavailable';
}) {
  const card = (id: string, name: string, tier: any, blurb: string, opts: { disabled?: boolean; gated?: boolean; comingSoon?: boolean } = {}) => {
    const active = selected === id;
    const isRec = recommendedId === id;
    // The engine cards are the app-selection surface: dormant they are
    // completely still, and a single beam traces the border on hover.
    return (
      <LightBeamCard
        key={id}
        selected={active}
        hoverable={!opts.disabled}
        onClick={opts.disabled ? undefined : () => onPick(id)}
        padding='11px 13px'
        radius={12}
        style={{
          textAlign: 'left',
          opacity: opts.disabled ? 0.55 : 1,
          boxShadow: isRec ? '0 0 0 3px ' + colors.beamGlow : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>{name}</span>
          {opts.comingSoon ? <EngineBadge tier='Coming Soon' /> : <EngineBadge tier={tier} />}
          {opts.gated ? <EngineBadge tier='Gated' /> : null}
          {isRec ? <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, color: T.warn }}>✨ PICK</span> : null}
        </div>
        <div style={{ fontSize: 10.5, color: T.muted, lineHeight: 1.45, marginTop: 4 }}>{blurb}</div>
      </LightBeamCard>
    );
  };

  const group = (title: string, children: React.ReactNode, note?: string) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: T.muted, marginBottom: note ? 3 : 7 }}>{title}</div>
      {note ? <div style={{ fontSize: 10.5, color: T.muted, lineHeight: 1.45, marginBottom: 7 }}>{note}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))', gap: 8 }}>{children}</div>
    </div>
  );

  const googleUp = GROUP_A_MODELS.filter((m: GroupAModel) => GOOGLE_UP_IDS.includes(m.id));
  const otherRoutes = GROUP_A_MODELS.filter((m: GroupAModel) => !GOOGLE_UP_IDS.includes(m.id));
  const runwayNote = runwayGate === 'ready'
    ? 'Runway is enabled on this platform.'
    : runwayGate === 'checking'
      ? 'Checking whether Runway is enabled…'
      : `${RUNWAY_DISABLED_MESSAGE} These engines cannot take a job right now.`;
  const runwayDisabled = runwayGate !== 'ready';

  return (
    <div>
      {group('Google — up and usable', googleUp.map((m: GroupAModel) => card(m.id, m.name, m.tier, `${m.blurb} · ${m.costHint}`)),
        'Omni Flash and the Veo family are the routes confirmed working. Start here.')}
      {group('Other routes — auto re-route on refusal', otherRoutes.map((m: GroupAModel) => card(m.id, m.name, m.tier, `${m.blurb} · ${m.costHint}`)),
        'Sora and the OpenRouter paths (Seedance 2.0 Fast on openrouter/bytedance/seedance-2.0-fast, OpenRouter Veo). If one of these refuses the job, the same brief is resubmitted on a Google engine and the swap is reported — you never lose the generation.')}
      {group('Runway — base video (gated)', RUNWAY_VIDEO_MODELS.map((m: RunwayVideoModel) => card(m.id, m.name, m.tier, `${m.blurb} · $${m.pricePerSecondUsd.toFixed(2)}/s`, { gated: true, disabled: runwayDisabled })), runwayNote)}
      {group('Runway Recipes (7)', RUNWAY_RECIPES.map((r) => card(r.id, r.name, 'Recipe', `${r.purpose} · ${r.priceNote}`, { gated: true, disabled: runwayDisabled })), runwayNote)}
      {KLING_MODELS.length ? group('Kling', KLING_MODELS.map((k) => card(k.id, k.name, k.tier, k.blurb, { comingSoon: true }))) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image Lab — Group D companion (gemini-3.1-flash-image / dall-e-3 / gpt-image-2)
// ---------------------------------------------------------------------------

function ImageLab() {
  const [model, setModel] = useState<'gemini-3.1-flash-image' | 'dall-e-3' | 'gpt-image-2'>('gemini-3.1-flash-image');
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [quality, setQuality] = useState<'standard' | 'hd'>('standard');
  const [editUrl, setEditUrl] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [out, setOut] = useState('');
  const def = IMAGE_MODELS.find((m) => m.id === model)!;

  useEffect(() => { if (!def.aspectRatios.includes(ratio)) setRatio(def.aspectRatios[0]); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    if (prompt.trim().length < 3 || busy) return;
    setBusy(true); setErr(''); setOut('');
    try {
      let url = '';
      if (model === 'gpt-image-2') {
        const res = await fetch('/api/generate/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim(), aspectRatio: ratio, quality, model: 'gpt-image-2' }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.imageUrl) throw new Error(String(data?.error || `Image generation failed (HTTP ${res.status}).`));
        url = String(data.imageUrl);
      } else {
        const body: Record<string, unknown> = { model, prompt: prompt.trim(), aspectRatio: ratio };
        if (model === 'gemini-3.1-flash-image' && editUrl[0]) {
          // editImageData wants raw base64 (no data: prefix) — fetch + strip.
          const blob = await fetch(editUrl[0]).then((r) => r.blob());
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => reject(new Error('Could not read the edit image.'));
            r.readAsDataURL(blob);
          });
          body.editImageData = dataUrl.split(',')[1] || '';
        }
        const res = await fetch('/api/veo/generate/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.imageUrl) {
          const details = Array.isArray(data?.details) ? data.details.map((d: any) => d?.message).filter(Boolean).join('; ') : '';
          throw new Error(details || String(data?.error || `Image generation failed (HTTP ${res.status}).`));
        }
        url = String(data.imageUrl);
      }
      setOut(url);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 18, display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 12.5, color: T.soft }}>Companion image generation — stills, seeds and reference frames for your videos. (The retired gemini-2.5-flash-image-preview is deliberately not offered.)</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {IMAGE_MODELS.map((m) => (
          <button key={m.id} type="button" onClick={() => setModel(m.id)} title={m.note} style={chip(model === m.id)}>{m.name}</button>
        ))}
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe the image…" style={{ ...inputStyle, resize: 'vertical', fontSize: 14 }} />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <span style={label}>Aspect ratio</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {def.aspectRatios.map((a) => <button key={a} type="button" onClick={() => setRatio(a)} style={chip(ratio === a)}>{a}</button>)}
          </div>
        </div>
        {model === 'gpt-image-2' ? (
          <div>
            <span style={label}>Quality</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['standard', 'hd'] as const).map((q) => <button key={q} type="button" onClick={() => setQuality(q)} style={chip(quality === q)}>{q}</button>)}
            </div>
          </div>
        ) : null}
      </div>
      {def.supportsEdit ? (
        <UploadZone title="Edit image (optional — image-to-image)" hint='"Keep this thing, change that thing" edits: the model transforms this image per your prompt.' urls={editUrl} max={1} onChange={setEditUrl} aiWrite={{ onWrite: setPrompt, target: 'description' }} />
      ) : null}
      <div>
        <button type="button" disabled={busy || prompt.trim().length < 3} onClick={() => void run()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: busy || prompt.trim().length < 3 ? T.raised : T.accentDeep, color: busy || prompt.trim().length < 3 ? T.muted : '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Generate image
        </button>
      </div>
      {err ? <div style={{ fontSize: 12.5, color: T.bad, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '9px 13px' }}>{err}</div> : null}
      {out ? (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14, maxWidth: 620 }}>
          <img src={out} alt="generated" style={{ width: '100%', borderRadius: 9, display: 'block' }} />
          <a href={out} target="_blank" rel="noreferrer" download style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 10, background: T.accentDeep, color: '#fff', borderRadius: 9, padding: '8px 15px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
            <Download size={13} /> Download
          </a>
        </div>
      ) : null}
    </div>
  );
}
