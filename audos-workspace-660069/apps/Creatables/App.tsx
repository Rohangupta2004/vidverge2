/**
 * CREATABLES — the unified video generation studio.
 * "All video engines. One place."
 *
 * Every approved engine on the platform, with per-model settings and a smart
 * recommendation engine:
 *   · GROUP A  — 12 models on POST /api/veo/generate/video (Omni Flash,
 *     Veo 3.1/3.1 Fast/3.0/3.0 Fast/2.0, Sora 2/2 Pro, Seedance 2.0 Fast and
 *     the three OpenRouter Veo 3.1 paths), polled at /api/veo/status/:id.
 *   · RUNWAY   — Gen 4.5 + Gen 4 Turbo base video and the 7 Recipes; a 503
 *     shows the friendly enabling note.
 *
 * Generate submits immediately — there is no quote step, no credit check and
 * no cooldown between pressing the button and the provider call.
 *   · KLING    — 4 models listed as [Coming Soon], disabled until the platform
 *     key lands.
 *   · IMAGE LAB — gemini-3.1-flash-image / dall-e-3 / gpt-image-2 companions.
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
  IMAGE_MODELS, RUNWAY_DISABLED_MESSAGE, RUNWAY_RATIOS, RUNWAY_RECIPES, RUNWAY_VIDEO_MODELS,
  RunwayVideoModel, groupAModel, isKlingModel, recommendEngine, runwayRecipe, runwayVideoModel,
  tierColor, validateGroupAInputs,
} from '../../lib/videoEngines';
import {
  EngineError, isRunwayDisabledError, pollGroupA, pollRunway,
  runwaySubmitVideo, submitGroupA,
} from '../../lib/videoEngineClient';
import { EngineBadge } from '../../components/EngineSelector';
import RunwayRecipesPanel from '../../components/RunwayRecipesPanel';

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
// Small UI atoms (space theme tokens with dark fallbacks)
// ---------------------------------------------------------------------------

const T = {
  ink: 'var(--space-text-primary, #F8FAFC)',
  soft: 'var(--space-text-secondary, #CBD5E1)',
  muted: 'var(--space-text-muted, #94A3B8)',
  card: 'var(--space-surface-card, #10182A)',
  panel: 'var(--space-surface-panel, #121C30)',
  raised: 'var(--space-surface-panel-strong, #18243A)',
  line: 'var(--space-border-default, rgba(148,163,184,0.16))',
  accent: 'var(--space-brand-primary-500, #3B82F6)',
  accentDeep: 'var(--space-brand-primary-600, #2563EB)',
  good: 'var(--space-semantic-success-600, #4ADE80)',
  bad: 'var(--space-semantic-danger, #F87171)',
  warn: '#E8A33C',
} as const;

const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: T.muted, display: 'block', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: T.panel, border: `1px solid ${T.line}`, borderRadius: 9, color: T.ink, fontSize: 13, padding: '9px 11px', outline: 'none' };
const chip = (active: boolean): React.CSSProperties => ({ background: active ? T.accentDeep : T.raised, color: active ? '#fff' : T.soft, border: `1px solid ${active ? 'transparent' : T.line}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' });

function UploadZone({ title, hint, urls, max, onChange, extra }: {
  title: string; hint?: string; urls: string[]; max: number;
  onChange: (urls: string[]) => void;
  extra?: (url: string, idx: number) => React.ReactNode;
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
  const [recommended, setRecommended] = useState<{ engineId: string; reason: string; caveat?: string } | null>(null);

  // ---- Group A settings ----
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [audio, setAudio] = useState(false);
  const [seedUrl, setSeedUrl] = useState<string[]>([]);
  const [lastFrameUrl, setLastFrameUrl] = useState<string[]>([]);
  const [refs, setRefs] = useState<{ url: string; type: 'asset' | 'style' }[]>([]);

  // ---- Runway base settings ----
  const [rwRatio, setRwRatio] = useState('1280:720');
  const [rwDuration, setRwDuration] = useState(5);
  const [rwImage, setRwImage] = useState<string[]>([]);
  const [runwayDown, setRunwayDown] = useState(false);

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
    if (phase !== 'running') return;
    const t = setInterval(() => setElapsedS(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  const gA = groupAModel(engineId);
  const rw = runwayVideoModel(engineId);
  const kling = isKlingModel(engineId);
  const recipeSel = runwayRecipe(engineId);
  const promptOk = prompt.trim().length >= 10;

  // Runway settings depend on mode: image-to-video unlocks the extra ratios.
  const rwRatios = useMemo(() => {
    if (!rw) return RUNWAY_RATIOS;
    const allowed = rwImage.length > 0 || !rw.textToVideo ? rw.i2vRatios : rw.t2vRatios;
    return RUNWAY_RATIOS.filter((r) => allowed.includes(r.value));
  }, [rw, rwImage.length]);
  useEffect(() => {
    if (rw && !rwRatios.some((r) => r.value === rwRatio) && rwRatios[0]) setRwRatio(rwRatios[0].value);
  }, [rw, rwRatios, rwRatio]);

  const combineViolation = gA ? validateGroupAInputs(engineId, {
    prompt,
    imageData: seedUrl[0] || null,
    referenceImages: refs.length ? refs : null,
    lastFrameImage: lastFrameUrl[0] ? { imageData: lastFrameUrl[0] } : null,
  }) : null;

  const canGenerate = promptOk && !kling && phase !== 'running' && (
    gA ? !combineViolation
      : rw ? (rw.textToVideo || rwImage.length > 0)
        : false
  );

  function pickEngine(id: string) {
    setEngineId(id);
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

  function buildRunwayBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { model: rw!.id, ratio: rwRatio, duration: rwDuration };
    if (rw!.id === 'gen4.5') {
      body.promptText = prompt.trim();
      if (rwImage[0]) { body.mode = 'image-to-video'; body.promptImage = rwImage[0]; }
    } else {
      // gen4_turbo — image-to-video only; promptImage as positioned frame array.
      body.promptImage = [{ uri: rwImage[0], position: 'first' }];
      if (prompt.trim()) body.promptText = prompt.trim();
    }
    return body;
  }

  async function generate() {
    if (!canGenerate) return;
    cancelled.current = false;
    setPhase('running'); setError(''); setFallbackNote(''); setOutputUrl(''); setNote('Submitting…'); setProgress(4);
    setOpId(''); setEta(''); setCost(''); setStartedAt(Date.now()); setElapsedS(0);
    let ranOn = gA?.name || rw?.name || engineId;
    try {
      let url = '';
      if (gA) {
        const kick = await submitGroupA({
          model: engineId,
          prompt,
          negativePrompt: negative || undefined,
          aspectRatio: aspect,
          duration,
          generateAudio: gA.supportsAudio ? audio : false,
          resolution: gA.supports4k ? resolution : (resolution === '4k' ? '1080p' : resolution),
          imageData: seedUrl[0] || undefined,
          referenceImages: refs.length ? refs.map((r) => ({ imageData: r.url, referenceType: r.type })) : undefined,
          lastFrameImage: lastFrameUrl[0] ? { imageData: lastFrameUrl[0] } : undefined,
        });
        setOpId(kick.operationId);
        if (kick.cost) setCost(`$${kick.cost}`);
        if (kick.estimatedDuration) setEta(kick.estimatedDuration);
        ranOn = groupAModel(kick.modelUsed)?.name || kick.modelUsed;
        if (kick.fallbackFrom) {
          setFallbackNote(`${gA.name} refused this job, so it is rendering on ${ranOn} instead. ${kick.fallbackReason || ''}`.trim());
        }
        setNote(`Rendering on ${ranOn}… polling every 5s`);
        setProgress(12);
        url = await pollGroupA(kick.operationId, {
          onProgress: (p) => setProgress(Math.max(12, Math.min(96, p))),
          isCancelled: () => cancelled.current,
        });
      } else if (rw) {
        const kick = await runwaySubmitVideo(buildRunwayBody());
        if (kick.uncertain) throw new EngineError('Runway accepted the request but the outcome is uncertain — do NOT resubmit; check back shortly.', { code: 'runway_uncertain' });
        setOpId(kick.taskId);
        setNote(`Runway task ${kick.status}… polling every 5s`);
        setProgress(12);
        const result = await pollRunway(kick.taskId, {
          onStatus: (s) => { setNote(`Runway — ${s}…`); setProgress((p) => Math.min(94, p + 4)); },
          isCancelled: () => cancelled.current,
        });
        url = result.mediaUrls[0] || '';
        setCost(`$${(rw.pricePerSecondUsd * rwDuration).toFixed(2)}`);
        if (!url) throw new EngineError('Runway succeeded but returned no media URL.', { code: 'no_media' });
      }
      setOutputUrl(url);
      setProgress(100);
      setPhase('done');
      setNote('Done.');
      setHistory(pushHistory({
        id: `h_${Date.now()}`, at: Date.now(), engine: engineId,
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
              <button key={id} type="button" onClick={() => setTab(id as Tab)} style={{ ...chip(tab === id), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={13} /> {name}</button>
            ))}
          </div>
        </div>

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
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={Math.min(8, Math.max(3, prompt.split('\n').length + 1))}
                placeholder="Describe your video — subject, action, setting, camera, mood. The more specific, the better the result."
                style={{ ...inputStyle, fontSize: 14.5, lineHeight: 1.55, padding: '14px 16px', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 11, color: promptOk ? T.muted : T.warn }}>{prompt.trim().length} / 1000 characters{promptOk ? '' : ' — at least 10 needed'}</span>
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

            {/* Engine grid */}
            <div style={{ marginTop: 22 }}>
              <span style={label}>Engine</span>
              <EngineGrid selected={engineId} recommendedId={recommended?.engineId || null} onPick={pickEngine} />
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
                        {FOUR_K_MODELS.includes(engineId) ? (
                          <button type="button" onClick={() => setResolution('4k')} style={chip(resolution === '4k')}>4K</button>
                        ) : null}
                      </div>
                    </div>
                    {gA.supportsAudio ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: T.soft, cursor: 'pointer', paddingBottom: 6 }}>
                        <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Generate audio
                      </label>
                    ) : null}
                  </div>

                  <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                    <UploadZone title="Seed image (image-to-video)" hint="The opening frame. Optional." urls={seedUrl} max={1} onChange={setSeedUrl} />
                    {gA.supportsReferenceImages ? (
                      <UploadZone
                        title="Reference images"
                        hint={gA.refsExclusiveWithSeed ? 'Up to 3. On this model refs are EXCLUSIVE with seed/last frame.' : 'Up to 3 — keeps the same character/product across scenes. May combine with a seed image.'}
                        urls={refs.map((r) => r.url)} max={3}
                        onChange={(urls) => setRefs(urls.map((u) => refs.find((r) => r.url === u) || { url: u, type: 'asset' }))}
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
                      <UploadZone title="Last frame (locks the ending)" hint="First/last-frame flow: seed opens the clip, this frame closes it." urls={lastFrameUrl} max={1} onChange={setLastFrameUrl} />
                    ) : null}
                  </div>

                  <div>
                    <span style={label}>Negative prompt (optional)</span>
                    <input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="Things that must NOT appear — e.g. on-screen text, watermarks, logos" style={inputStyle} />
                  </div>

                  {combineViolation && (seedUrl.length || refs.length || lastFrameUrl.length) ? (
                    <div style={{ fontSize: 12, color: T.warn, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 9, padding: '8px 12px' }}>{combineViolation}</div>
                  ) : null}

                  <div style={{ fontSize: 12, color: T.muted }}>Estimated cost: <b style={{ color: T.soft }}>{gA.costHint}</b> — the exact charge is reported when the render starts.</div>
                </div>
              ) : rw ? (
                <div style={{ display: 'grid', gap: 16 }}>
                  {runwayDown ? <div style={{ fontSize: 12.5, color: T.warn, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 9, padding: '8px 12px' }}>{RUNWAY_DISABLED_MESSAGE}</div> : null}
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
                    urls={rwImage} max={1} onChange={setRwImage}
                  />
                </div>
              ) : recipeSel ? (
                <div style={{ fontSize: 12.5, color: T.soft }}>Recipe engines run from the <b>Runway Recipes</b> tab — it just opened for you.</div>
              ) : null}
            </div>

            {/* Generate */}
            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => void generate()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: canGenerate ? T.accentDeep : T.raised, color: canGenerate ? '#fff' : T.muted, border: 'none', borderRadius: 11, padding: '13px 26px', fontSize: 14, fontWeight: 800, cursor: canGenerate ? 'pointer' : 'default', boxShadow: canGenerate ? '0 2px 14px rgba(37,99,235,0.35)' : 'none' }}
              >
                {phase === 'running' ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {phase === 'running' ? 'Generating…' : 'Generate video'}
              </button>
              {phase === 'running' ? (
                <button type="button" onClick={() => { cancelled.current = true; }} style={{ ...chip(false) }}>Stop watching</button>
              ) : null}
              {!promptOk ? <span style={{ fontSize: 12, color: T.muted }}>Write at least 10 characters to unlock Generate.</span>
                : kling ? <span style={{ fontSize: 12, color: T.muted }}>{KLING_COMING_SOON_MESSAGE}</span>
                : gA && combineViolation && (seedUrl.length || refs.length || lastFrameUrl.length) ? <span style={{ fontSize: 12, color: T.warn }}>{combineViolation}</span>
                : null}
            </div>

            {/* Progress */}
            {phase === 'running' ? (
              <div style={{ marginTop: 16, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 15 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: T.soft, marginBottom: 8 }}>
                  <span><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2, marginRight: 6 }} />{note}</span>
                  <span style={{ color: T.muted }}>{elapsedS}s elapsed{eta ? ` · est. ${eta}` : ''}</span>
                </div>
                <div style={{ height: 7, background: T.raised, borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: T.accent, transition: 'width 600ms ease' }} />
                </div>
                {opId ? <div style={{ fontSize: 10.5, color: T.muted, marginTop: 7, fontFamily: 'monospace' }}>operation: {opId}{cost ? ` · cost: ${cost}` : ''}</div> : null}
              </div>
            ) : null}

            {fallbackNote ? (
              <div style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.55, color: T.warn, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 10, padding: '10px 14px' }}>
                {fallbackNote}
              </div>
            ) : null}

            {error ? (
              <div style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.55, color: error === RUNWAY_DISABLED_MESSAGE ? T.warn : T.bad, background: error === RUNWAY_DISABLED_MESSAGE ? 'rgba(232,163,60,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${error === RUNWAY_DISABLED_MESSAGE ? 'rgba(232,163,60,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: 10, padding: '10px 14px' }}>
                {error}
                {phase === 'error' && (error.includes('502') || /safe to retry/i.test(error)) ? (
                  <button type="button" onClick={() => void generate()} style={{ ...chip(false), marginLeft: 10, padding: '4px 10px', fontSize: 11.5 }}><RefreshCw size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Retry</button>
                ) : null}
              </div>
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
                    {(gA?.name || rw?.name || engineId)} · {elapsedS}s generation time{cost ? ` · ${cost}` : ''}
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine card grid — grouped by provider
// ---------------------------------------------------------------------------

function EngineGrid({ selected, recommendedId, onPick }: {
  selected: string;
  recommendedId: string | null;
  onPick: (id: string) => void;
}) {
  const card = (id: string, name: string, tier: any, blurb: string, opts: { disabled?: boolean; gated?: boolean; comingSoon?: boolean } = {}) => {
    const active = selected === id;
    const isRec = recommendedId === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => { if (!opts.disabled) onPick(id); }}
        aria-pressed={active}
        style={{
          textAlign: 'left', borderRadius: 12, padding: '11px 13px', cursor: opts.disabled ? 'default' : 'pointer',
          background: active ? 'color-mix(in srgb, var(--space-brand-primary-500, #3B82F6) 12%, transparent)' : T.card,
          border: `1.5px solid ${active ? T.accent : isRec ? T.warn : T.line}`,
          opacity: opts.disabled ? 0.55 : 1,
          boxShadow: isRec ? '0 0 0 3px rgba(232,163,60,0.12)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>{name}</span>
          {opts.comingSoon ? <EngineBadge tier="Coming Soon" /> : <EngineBadge tier={tier} />}
          {opts.gated ? <EngineBadge tier="Gated" /> : null}
          {isRec ? <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, color: T.warn }}>✨ PICK</span> : null}
        </div>
        <div style={{ fontSize: 10.5, color: T.muted, lineHeight: 1.45, marginTop: 4 }}>{blurb}</div>
      </button>
    );
  };

  const group = (title: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: T.muted, marginBottom: 7 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))', gap: 8 }}>{children}</div>
    </div>
  );

  return (
    <div>
      {group('Google · OpenAI · OpenRouter (12 models)', GROUP_A_MODELS.map((m: GroupAModel) => card(m.id, m.name, m.tier, `${m.blurb} · ${m.costHint}`)))}
      {group('Runway — base video (gated)', RUNWAY_VIDEO_MODELS.map((m: RunwayVideoModel) => card(m.id, m.name, m.tier, `${m.blurb} · $${m.pricePerSecondUsd.toFixed(2)}/s`, { gated: true })))}
      {group('Runway Recipes (7)', RUNWAY_RECIPES.map((r) => card(r.id, r.name, 'Recipe', `${r.purpose} · ${r.priceNote}`, { gated: true })))}
      {group('Kling — Coming Soon', KLING_MODELS.map((k) => card(k.id, k.name, k.tier, k.blurb, { comingSoon: true })))}
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
        <UploadZone title="Edit image (optional — image-to-image)" hint='"Keep this thing, change that thing" edits: the model transforms this image per your prompt.' urls={editUrl} max={1} onChange={setEditUrl} />
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
