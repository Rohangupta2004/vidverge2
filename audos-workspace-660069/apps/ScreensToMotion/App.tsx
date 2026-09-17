/**
 * Screens to Motion — PNG screenshots of any app in, a product demo video
 * with real motion design out. No UI rebuilding in code. No editor. No human
 * in the loop: the screenshots are the UI; the software supplies motion,
 * framing, and typography.
 *
 * TWO ROUTES:
 * - Screenshots only (Phase 1, unchanged): URL → brief → screenshots →
 *   analyse → plan → render → MP4.
 * - Presenter Mix (Phase 2): the same screenshot input + optional real
 *   footage (MP4/MOV uploads), gated Veo atmosphere clips, an optional HeyGen
 *   presenter (character approved in-app first), and an optional music bed —
 *   all conformed, graded and cut together on a beat grid into ONE MP4.
 */
import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { ArrowLeft, Check, Clapperboard, Download, Film, Images, Loader2, Mic, MonitorPlay, Music, RefreshCw, Sparkles, Upload, UserRound, Video, Wand2, X } from 'lucide-react';
import { ingestFiles, validateBrief, validateFileSet, IngestError, type IngestResult } from './src/analyse/ingest';
import { analyseAll } from './src/analyse/analyse';
import { planVideo, type PlanMix } from './src/plan/plan';
import { submitRender, pollRender } from './src/cli';
import { ingestClipFiles, validateClipFile, ClipError } from './src/clips/probe';
import { conformClips, resolveExposureDips } from './src/clips/conform';
import { gradePlan, statsFromCanvas } from './src/clips/grade';
import { generateAtmosphereClip } from './src/clips/veo';
import { generateCharacterImage, renderAvatarClip, type CharacterCandidate } from './src/clips/heygen';
import { detectBpm, BpmError } from './src/sync/bpm';
import { impliedSync } from './src/sync/grid';
import { CLIP_RULES, INGEST_RULES, type ClipStats, type IngestedClip, type ScreenAnalysis, type SyncSpec, type VideoPlan } from './src/types';

type Stage = 'intake' | 'running' | 'done' | 'failed';
type Route = 'screens' | 'mix';

interface Progress { label: string; detail: string; step: number; total: number; }

type PresenterState =
  | { status: 'off' }
  | { status: 'generating' }
  | { status: 'awaiting-approval'; candidate: CharacterCandidate }
  | { status: 'approved'; candidate: CharacterCandidate }
  | { status: 'failed'; error: string };

const CSS = `
@keyframes stm-spin { to { transform: rotate(360deg) } }
@keyframes stm-rise { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:none } }
.stm-spin { animation: stm-spin .8s linear infinite }
.stm-rise { animation: stm-rise .4s cubic-bezier(.16,1,.3,1) both }
.stm-btn { transition: transform .16s ease, filter .16s ease }
.stm-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.07) }
.stm-btn:active:not(:disabled) { transform: scale(.985) }
@media (prefers-reduced-motion:reduce) { .stm-spin,.stm-rise { animation:none!important } }
`;

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  return String(token);
}

function activeWorkspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || (window as any).__WORKSPACE_ID__ || '');
}

async function uploadMusic(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('workspaceId', activeWorkspaceId());
  form.append('folder', 'screens-to-motion/music');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) throw new Error(body?.error || `"${file.name}" could not be uploaded (${response.status}).`);
  return String(body.url);
}

/** Short spoken script for the HeyGen presenter — written by the fast text model. */
async function writePresenterScript(brief: string): Promise<string> {
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      max_completion_tokens: 300,
      messages: [
        { role: 'system', content: 'Write a 45–60 word spoken presenter script introducing the product from the brief. Warm, direct, no hype words, no stage directions, no quotation marks, no emoji. Output the script text only.' },
        { role: 'user', content: brief },
      ],
      stream: false,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `The presenter script could not be written (${response.status}).`);
  const text = String(body?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('The presenter script came back empty.');
  return text;
}

/** Atmosphere seeds — texture and context only; the gate enforces the rest. */
const ATMOSPHERE_IDEAS = [
  'Close-up of hands resting on a desk beside a coffee cup in a softly lit workspace, morning window light, gentle camera drift',
  'Slow dolly across a modern studio desk at dusk — warm lamp glow, plants, soft shadows, cinematic bokeh',
];

async function saveToMyVideos(input: { title: string; videoUrl: string; plan: VideoPlan; screenCount: number; route: Route }): Promise<void> {
  const db = (window as any).__workspaceDb;
  if (!db) return;
  const frames = input.plan.scenes.reduce((sum, s) => sum + s.duration, 0);
  await db.from('video_jobs').insert({
    job_id: `screens_motion_${Date.now()}`,
    title: input.title,
    status: 'completed',
    video_url: input.videoUrl,
    delivery_url: input.videoUrl,
    source: 'remotion',
    phase_mode: false,
    model_used: input.route === 'mix' ? 'screens-to-motion-mix' : 'screens-to-motion',
    tone: `${input.plan.motion} motion preset`,
    duration_seconds: Math.round(frames / input.plan.meta.fps),
    scene_count: input.plan.scenes.length,
    aspect_ratio: '16:9',
    script_json: input.plan.scenes.map((s: any) => ({
      scene_description: s.kind === 'clip' ? `footage ${s.src} (${s.audio})` : `${s.bed?.op || 'push'} on ${s.screenId}`,
      dialogue: s.overlay?.text || '',
    })),
  }).catch(() => null);
}

const card: CSSProperties = {
  padding: 'clamp(18px,4vw,28px)',
  borderRadius: 20,
  border: '1px solid var(--space-border-default)',
  background: 'var(--space-surface-card)',
};

const pillButton = (active: boolean): CSSProperties => ({
  flex: '1 1 0',
  minHeight: 46,
  borderRadius: 13,
  border: active ? '1px solid var(--space-brand-primary-500)' : '1px solid var(--space-border-default)',
  cursor: 'pointer',
  color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)',
  background: active ? 'linear-gradient(135deg,var(--space-brand-primary-500),var(--space-brand-primary-700))' : 'var(--space-surface-panel)',
  fontWeight: 720,
  fontSize: 13.5,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
});

export default function App() {
  const [stage, setStage] = useState<Stage>('intake');
  const [route, setRoute] = useState<Route>('screens');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [brief, setBrief] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Progress>({ label: '', detail: '', step: 0, total: 5 });
  const [videoUrl, setVideoUrl] = useState('');
  const [plan, setPlan] = useState<VideoPlan | null>(null);
  const [mixNotes, setMixNotes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // --- Presenter Mix state ---------------------------------------------------
  const [clipFiles, setClipFiles] = useState<File[]>([]);
  const clipInputRef = useRef<HTMLInputElement | null>(null);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicSync, setMusicSync] = useState<SyncSpec | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const musicInputRef = useRef<HTMLInputElement | null>(null);
  const [atmosphereCount, setAtmosphereCount] = useState(0);
  const [presenter, setPresenter] = useState<PresenterState>({ status: 'off' });

  const briefLength = brief.replace(/\s+/g, ' ').trim().length;
  const briefOk = briefLength >= INGEST_RULES.briefMinChars && briefLength <= INGEST_RULES.briefMaxChars;
  const filesOk = files.length >= INGEST_RULES.minFiles && files.length <= INGEST_RULES.maxFiles;
  const presenterCount = presenter.status === 'off' || presenter.status === 'failed' ? 0 : 1;
  const clipBudgetUsed = clipFiles.length + atmosphereCount + presenterCount;
  const clipBudgetOk = clipBudgetUsed <= CLIP_RULES.maxClips;
  const presenterReady = presenter.status === 'off' || presenter.status === 'failed' || presenter.status === 'approved';
  const mixOk = route !== 'mix' || (clipBudgetOk && presenterReady && !musicBusy);
  const canGenerate = briefOk && filesOk && mixOk && stage === 'intake';
  const progressPercent = Math.max(4, Math.min(100, Math.round((progress.step / progress.total) * 100)));

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length === 0) return;
    const next = [...files, ...incoming].slice(0, INGEST_RULES.maxFiles);
    try {
      for (const f of incoming) {
        if (!(INGEST_RULES.acceptedTypes as readonly string[]).includes(f.type)) {
          throw new IngestError(`"${f.name}" is not a PNG or JPEG screenshot.`);
        }
      }
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Only PNG and JPEG screenshots are accepted.');
      return;
    }
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    const next = files.filter((_, i) => i !== index);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  };

  const addClips = (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length === 0) return;
    try {
      for (const f of incoming) validateClipFile(f);
      const next = [...clipFiles, ...incoming];
      if (next.length + atmosphereCount + presenterCount > CLIP_RULES.maxClips) {
        throw new ClipError(`At most ${CLIP_RULES.maxClips} clips per video (uploads + atmosphere + presenter).`);
      }
      setClipFiles(next);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Only MP4 and MOV clips are accepted.');
    }
    if (clipInputRef.current) clipInputRef.current.value = '';
  };

  const pickMusic = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = (event.target.files || [])[0];
    if (musicInputRef.current) musicInputRef.current.value = '';
    if (!file) return;
    setMusicBusy(true);
    setMusicFile(file);
    setMusicSync(null);
    try {
      // Tempo comes from the actual audio — never guessed from a description.
      const sync = await detectBpm(await file.arrayBuffer());
      setMusicSync(sync);
      setError('');
    } catch (caught) {
      setMusicFile(null);
      setError(caught instanceof BpmError ? caught.message : 'Tempo detection failed on this track — try another file.');
    } finally {
      setMusicBusy(false);
    }
  };

  const startPresenter = async () => {
    if (!briefOk) {
      setError(`Write the brief first (${INGEST_RULES.briefMinChars}–${INGEST_RULES.briefMaxChars} characters) — the character is generated from it.`);
      return;
    }
    setError('');
    setPresenter({ status: 'generating' });
    try {
      const candidate = await generateCharacterImage(validateBrief(brief));
      setPresenter({ status: 'awaiting-approval', candidate });
    } catch (caught) {
      setPresenter({ status: 'failed', error: caught instanceof Error ? caught.message : 'Character generation failed.' });
    }
  };

  // ------------------------------------------------------------- pipelines ----

  const generateScreensOnly = async () => {
    // Route 1 — byte-for-byte the Phase 1 flow.
    validateFileSet(files);
    const cleanBrief = validateBrief(brief);
    const token = workspaceToken();
    const workspaceIdValue = activeWorkspaceId();
    const total = 5;

    setProgress({ step: 1, total, label: 'Ingesting screenshots', detail: 'Stripping EXIF, converting sRGB, recording true pixel sizes, uploading.' });
    const { screens } = await ingestFiles(files, cleanBrief);

    setProgress({ step: 2, total, label: 'Reading every screen', detail: `Vision analysis 0/${screens.length} — regions, palette, safe crops, plate rings.` });
    const analyses: ScreenAnalysis[] = await analyseAll(screens, (done, count) => {
      setProgress({ step: 2, total, label: 'Reading every screen', detail: `Vision analysis ${done}/${count} — regions, palette, safe crops, plate rings.` });
    });

    setProgress({ step: 3, total, label: 'Directing the motion plan', detail: 'Beds, accents, UI motion, overlays — schema-checked, rule-checked.' });
    const { plan: builtPlan, issues } = await planVideo(cleanBrief, analyses, screens.map((s) => s.screen), (message) => {
      setProgress({ step: 3, total, label: 'Directing the motion plan', detail: message });
    });
    if (issues.length > 0) {
      console.warn('[screens-to-motion] shipping with repaired plan; residual notes:', issues);
    }
    setPlan(builtPlan);

    setProgress({ step: 4, total, label: 'Rendering', detail: 'One deterministic Remotion composition, rendered server-side.' });
    const handle = await submitRender({ plan: builtPlan, images: screens.map((s) => s.screen), analyses }, token, workspaceIdValue);
    const finished = await pollRender(handle, token, (state, pct) => {
      setProgress({ step: 4, total, label: 'Rendering', detail: `Render ${state}${pct ? ` — ${Math.round(pct * 100)}%` : '…'}` });
    });

    setProgress({ step: 5, total, label: 'Done', detail: 'Saved to My Videos.' });
    await saveToMyVideos({ title: builtPlan.meta.title || 'Screens to Motion demo', videoUrl: finished, plan: builtPlan, screenCount: screens.length, route: 'screens' });
    setVideoUrl(finished);
    setStage('done');
  };

  const generateMix = async () => {
    validateFileSet(files);
    const cleanBrief = validateBrief(brief);
    const token = workspaceToken();
    const workspaceIdValue = activeWorkspaceId();
    const notes: string[] = [];
    const total = 7;

    setProgress({ step: 1, total, label: 'Ingesting screenshots', detail: 'Stripping EXIF, converting sRGB, recording true pixel sizes, uploading.' });
    const { screens } = await ingestFiles(files, cleanBrief);
    const screenStatsById = new Map<string, ClipStats>();
    for (const item of screens as IngestResult[]) {
      const stats = statsFromCanvas(item.canvas);
      if (stats) screenStatsById.set(item.screen.screenId, stats);
    }

    // Music → beat grid. No music? Implied tempo, quantised the same way.
    setProgress({ step: 2, total, label: 'Locking the beat grid', detail: musicFile ? 'Uploading the music bed…' : 'No music supplied — using an implied tempo grid.' });
    let musicUrl: string | null = null;
    let sync: SyncSpec = musicSync || impliedSync();
    if (musicFile) musicUrl = await uploadMusic(musicFile);

    // Presenter: script + HeyGen render kick off first — it is the slow path.
    // The promise is settled into a result object immediately so a rejection
    // that lands while atmosphere clips generate is never left unhandled.
    let presenterPromise: Promise<{ ok: true; clip: IngestedClip } | { ok: false; error: Error }> | null = null;
    if (presenter.status === 'approved') {
      setProgress({ step: 2, total, label: 'Locking the beat grid', detail: 'Writing the presenter script…' });
      const script = await writePresenterScript(cleanBrief);
      presenterPromise = renderAvatarClip(presenter.candidate, script, 'cp', (message) => {
        console.info(`[screens-to-motion:heygen] ${message}`);
      }).then(
        (clip) => ({ ok: true as const, clip }),
        (caught) => ({ ok: false as const, error: caught instanceof Error ? caught : new Error(String(caught)) }),
      );
    }

    // Founder uploads — probed for TRUE fps, dimensions, duration.
    setProgress({ step: 3, total, label: 'Conforming footage', detail: clipFiles.length ? `Uploading and probing ${clipFiles.length} clip${clipFiles.length > 1 ? 's' : ''}…` : 'No uploaded clips.' });
    const clips: IngestedClip[] = await ingestClipFiles(clipFiles, 0);

    // Gated Veo atmosphere.
    for (let i = 0; i < atmosphereCount; i++) {
      const idea = ATMOSPHERE_IDEAS[i % ATMOSPHERE_IDEAS.length];
      setProgress({ step: 3, total, label: 'Generating atmosphere', detail: `Clip ${i + 1}/${atmosphereCount}: ${idea.slice(0, 60)}…` });
      const result = await generateAtmosphereClip(idea, `ca${i + 1}`, workspaceIdValue, (message) => {
        setProgress({ step: 3, total, label: 'Generating atmosphere', detail: `Clip ${i + 1}/${atmosphereCount}: ${message}` });
      });
      if (result.clip) {
        clips.push(result.clip);
        if (result.rejectionLog.length) notes.push(`Atmosphere clip ${i + 1} passed the gate after ${result.attempts} attempt(s).`);
      } else {
        notes.push(`Atmosphere clip ${i + 1} was rejected by the gate ${result.attempts} times (screens/text/logos detected) — fell back to your screenshots.`);
      }
    }

    if (presenterPromise) {
      setProgress({ step: 4, total, label: 'Rendering the presenter', detail: 'HeyGen is rendering your approved character…' });
      const settled = await presenterPromise;
      if (!settled.ok) throw settled.error;
      clips.push(settled.clip);
    }

    // Conform: exact integer frame-mapping onto the fixed 30fps grid.
    const conformNotes = conformClips(clips);
    for (const note of conformNotes) notes.push(`Clip ${note.clipId}: ${note.message}`);

    setProgress({ step: 5, total, label: 'Reading every screen', detail: `Vision analysis 0/${screens.length} — regions, palette, safe crops, plate rings.` });
    const analyses: ScreenAnalysis[] = await analyseAll(screens, (done, count) => {
      setProgress({ step: 5, total, label: 'Reading every screen', detail: `Vision analysis ${done}/${count} — regions, palette, safe crops, plate rings.` });
    });

    setProgress({ step: 6, total, label: 'Directing the mixed cut', detail: 'Clip scenes, carries, plates, beat quantisation — schema-checked, rule-checked.' });
    const presenterNote = clips.some((c) => c.source === 'heygen')
      ? 'Clip cp is the HeyGen presenter: give it ONE clip scene with audio "duck", placed in the first half. Atmosphere clips open or bridge — never more than one in a row.'
      : undefined;
    const mix: PlanMix = { clips, sync, presenterNote };
    const { plan: builtPlan, issues } = await planVideo(cleanBrief, analyses, screens.map((s) => s.screen), (message) => {
      setProgress({ step: 6, total, label: 'Directing the mixed cut', detail: message });
    }, clips.length > 0 ? mix : { clips: [], sync });
    if (issues.length > 0) {
      console.warn('[screens-to-motion] shipping with repaired plan; residual notes:', issues);
    }
    builtPlan.music = musicUrl ? { url: musicUrl } : null;

    // grade:"auto" sampling over each planned trim → video-wide UI grade,
    // then the >12% luminance rule inserts 4-frame dips at mismatched cuts.
    setProgress({ step: 6, total, label: 'Matching grade and exposure', detail: 'Sampling footage black point, white point and saturation across every trim…' });
    const clipsById = new Map(clips.map((c) => [c.clipId, c] as const));
    const lumaBySceneId = await gradePlan(builtPlan, clipsById, screenStatsById, workspaceIdValue);
    const dips = resolveExposureDips(builtPlan, lumaBySceneId);
    if (dips.applied.length) notes.push(`Exposure dips inserted at ${dips.applied.length} cut(s) where luminance differed by more than 12%.`);
    setPlan(builtPlan);

    setProgress({ step: 7, total, label: 'Rendering', detail: 'One deterministic Remotion composition — OffthreadVideo clips, ffmpeg-extracted frames.' });
    const handle = await submitRender({ plan: builtPlan, images: screens.map((s) => s.screen), analyses, clips }, token, workspaceIdValue);
    const finished = await pollRender(handle, token, (state, pct) => {
      setProgress({ step: 7, total, label: 'Rendering', detail: `Render ${state}${pct ? ` — ${Math.round(pct * 100)}%` : '…'}` });
    });

    setProgress({ step: 7, total, label: 'Done', detail: 'Saved to My Videos.' });
    await saveToMyVideos({ title: builtPlan.meta.title || 'Presenter Mix demo', videoUrl: finished, plan: builtPlan, screenCount: screens.length, route: 'mix' });
    setMixNotes(notes);
    setVideoUrl(finished);
    setStage('done');
  };

  const generate = async () => {
    setError('');
    setMixNotes([]);
    setStage('running');
    try {
      if (route === 'mix') await generateMix();
      else await generateScreensOnly();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The demo video could not be completed.');
      setStage(files.length ? 'intake' : 'failed');
    }
  };

  const reset = () => {
    setStage('intake');
    setVideoUrl('');
    setPlan(null);
    setError('');
    setMixNotes([]);
    setProgress({ label: '', detail: '', step: 0, total: route === 'mix' ? 7 : 5 });
  };

  const counts = useMemo(() => `${files.length} / ${INGEST_RULES.maxFiles} screenshots · brief ${briefLength} / ${INGEST_RULES.briefMaxChars}`, [files.length, briefLength]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 0, overflowY: 'auto', color: 'var(--space-text-primary)', background: 'radial-gradient(900px 460px at 50% -8%,color-mix(in srgb,var(--space-brand-primary-500) 20%,transparent),transparent 64%),var(--space-surface-bg)', fontFamily: "'Inter','Geist',system-ui,sans-serif" }}>
      <style>{CSS}</style>
      <main style={{ width: 'min(920px,100%)', margin: '0 auto', boxSizing: 'border-box', padding: 'clamp(20px,4vw,48px) clamp(16px,5vw,48px) 72px' }}>
        <header className="stm-rise" style={{ marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--space-text-brand)', fontSize: 12, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>
            <MonitorPlay size={15} /> Screens to Motion
          </div>
          <h1 style={{ margin: '12px 0 0', fontSize: 'clamp(32px,5.4vw,54px)', lineHeight: 1.04, letterSpacing: '-.045em' }}>
            Your screenshots.<br /><span style={{ color: 'var(--space-text-brand)' }}>Real motion design.</span>
          </h1>
          <p style={{ maxWidth: 640, margin: '14px 0 0', color: 'var(--space-text-secondary)', fontSize: 15, lineHeight: 1.65 }}>
            Drop {INGEST_RULES.minFiles}–{INGEST_RULES.maxFiles} PNG screenshots (at least {INGEST_RULES.minWidth}px wide) and a short brief. Screenshots only, or Presenter Mix — real footage, a HeyGen presenter and a music bed, cut together on the beat.
          </p>
        </header>

        {stage === 'intake' || stage === 'failed' ? (
          <section className="stm-rise" style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="stm-btn" style={pillButton(route === 'screens')} onClick={() => setRoute('screens')} data-testid="stm-route-screens">
                <Images size={15} /> Screenshots only
              </button>
              <button type="button" className="stm-btn" style={pillButton(route === 'mix')} onClick={() => setRoute('mix')} data-testid="stm-route-mix">
                <Clapperboard size={15} /> Presenter Mix
              </button>
            </div>

            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Images size={16} color="var(--space-text-brand)" /> Screenshots</strong>
                <span style={{ color: 'var(--space-text-muted)', fontSize: 12 }}>{counts}</span>
              </div>
              <input ref={inputRef} type="file" accept="image/png,image/jpeg" multiple onChange={addFiles} style={{ display: 'none' }} data-testid="stm-file-input" />
              <button type="button" className="stm-btn" onClick={() => inputRef.current?.click()} style={{ width: '100%', minHeight: 88, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, border: '1px dashed var(--space-border-strong)', cursor: 'pointer', color: 'var(--space-text-secondary)', background: 'var(--space-surface-muted)' }} data-testid="stm-add-files">
                <Upload size={18} />
                <span style={{ fontSize: 13 }}>Add PNG / JPEG screenshots — min {INGEST_RULES.minWidth}px wide</span>
              </button>
              {files.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10, marginTop: 14 }}>
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)' }}>
                      <img src={previews[index]} alt={file.name} style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
                      <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`} style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 99, border: 0, cursor: 'pointer', color: '#fff', background: 'rgba(2,6,23,.72)' }}><X size={13} /></button>
                      <span style={{ position: 'absolute', left: 6, bottom: 6, padding: '2px 7px', borderRadius: 99, background: 'rgba(2,6,23,.72)', color: '#fff', fontSize: 10 }}>{index + 1}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={card}>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Clapperboard size={16} color="var(--space-text-brand)" /> Brief</strong>
              <textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                rows={4}
                placeholder="What is this product, who is it for, and what should the demo make people feel? (40–600 characters)"
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 14, borderRadius: 14, border: '1px solid var(--space-border-default)', color: 'var(--space-text-primary)', background: 'var(--space-surface-panel)', font: 'inherit', lineHeight: 1.55 }}
                data-testid="stm-brief"
              />
              <div style={{ marginTop: 8, fontSize: 12, color: briefOk || briefLength === 0 ? 'var(--space-text-muted)' : 'var(--space-semantic-danger)' }}>
                {briefLength} characters — needs {INGEST_RULES.briefMinChars}–{INGEST_RULES.briefMaxChars}.
              </div>
            </div>

            {route === 'mix' ? (
              <>
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Video size={16} color="var(--space-text-brand)" /> Footage</strong>
                    <span style={{ color: clipBudgetOk ? 'var(--space-text-muted)' : 'var(--space-semantic-danger)', fontSize: 12 }}>{clipBudgetUsed} / {CLIP_RULES.maxClips} clips (uploads + atmosphere + presenter)</span>
                  </div>
                  <input ref={clipInputRef} type="file" accept="video/mp4,video/quicktime" multiple onChange={addClips} style={{ display: 'none' }} data-testid="stm-clip-input" />
                  <button type="button" className="stm-btn" onClick={() => clipInputRef.current?.click()} style={{ width: '100%', minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, border: '1px dashed var(--space-border-strong)', cursor: 'pointer', color: 'var(--space-text-secondary)', background: 'var(--space-surface-muted)' }} data-testid="stm-add-clips">
                    <Upload size={16} />
                    <span style={{ fontSize: 13 }}>Add MP4 / MOV clips — minimum 1080p, true fps read on ingest</span>
                  </button>
                  {clipFiles.length > 0 ? (
                    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                      {clipFiles.map((file, index) => (
                        <div key={`${file.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 11, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', fontSize: 13 }}>
                          <Film size={14} color="var(--space-text-brand)" />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                          <span style={{ color: 'var(--space-text-muted)', fontSize: 11 }}>{(file.size / 1048576).toFixed(1)} MB</span>
                          <button type="button" onClick={() => setClipFiles(clipFiles.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`} style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 99, border: 0, cursor: 'pointer', color: '#fff', background: 'rgba(2,6,23,.72)' }}><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--space-text-secondary)' }}><Wand2 size={14} color="var(--space-text-brand)" /> Veo atmosphere clips (gated — no screens, no text, no logos):</span>
                    {[0, 1, 2].map((n) => (
                      <button key={n} type="button" className="stm-btn" disabled={clipFiles.length + n + presenterCount > CLIP_RULES.maxClips} onClick={() => setAtmosphereCount(n)} style={{ minWidth: 44, minHeight: 34, borderRadius: 10, border: atmosphereCount === n ? '1px solid var(--space-brand-primary-500)' : '1px solid var(--space-border-default)', cursor: 'pointer', color: atmosphereCount === n ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)', background: atmosphereCount === n ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel)', opacity: clipFiles.length + n + presenterCount > CLIP_RULES.maxClips ? 0.4 : 1, fontWeight: 700 }} data-testid={`stm-atmosphere-${n}`}>{n}</button>
                    ))}
                  </div>
                </div>

                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Music size={16} color="var(--space-text-brand)" /> Music bed <span style={{ color: 'var(--space-text-muted)', fontWeight: 500, fontSize: 12 }}>optional — every cut lands on its beat</span></strong>
                    {musicSync ? <span style={{ color: 'var(--space-semantic-success)', fontSize: 12, fontWeight: 700 }}>{musicSync.bpm} bpm detected</span> : null}
                  </div>
                  <input ref={musicInputRef} type="file" accept="audio/*" onChange={(e) => void pickMusic(e)} style={{ display: 'none' }} data-testid="stm-music-input" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="stm-btn" onClick={() => musicInputRef.current?.click()} disabled={musicBusy} style={{ minHeight: 42, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 12, border: '1px dashed var(--space-border-strong)', cursor: 'pointer', color: 'var(--space-text-secondary)', background: 'var(--space-surface-muted)', fontSize: 13 }}>
                      {musicBusy ? <Loader2 size={14} className="stm-spin" /> : <Upload size={14} />} {musicBusy ? 'Detecting tempo…' : musicFile ? musicFile.name : 'Add a music track (MP3 / WAV / M4A)'}
                    </button>
                    {musicFile && !musicBusy ? (
                      <button type="button" onClick={() => { setMusicFile(null); setMusicSync(null); }} style={{ minHeight: 42, padding: '0 12px', borderRadius: 12, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-secondary)', background: 'var(--space-surface-panel)', fontSize: 13 }}>Remove</button>
                    ) : null}
                    {!musicFile && !musicBusy ? <span style={{ fontSize: 12, color: 'var(--space-text-muted)' }}>No track → an implied 100bpm grid still quantises every cut.</span> : null}
                  </div>
                </div>

                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><UserRound size={16} color="var(--space-text-brand)" /> HeyGen presenter <span style={{ color: 'var(--space-text-muted)', fontWeight: 500, fontSize: 12 }}>optional — approve the character before it renders</span></strong>
                    {presenter.status === 'approved' ? <span style={{ color: 'var(--space-semantic-success)', fontSize: 12, fontWeight: 700 }}>Approved</span> : null}
                  </div>
                  {presenter.status === 'off' || presenter.status === 'failed' ? (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {presenter.status === 'failed' ? <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)' }}>{presenter.error}</div> : null}
                      <button type="button" className="stm-btn" disabled={clipBudgetUsed >= CLIP_RULES.maxClips} onClick={() => void startPresenter()} style={{ minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-primary)', background: 'var(--space-surface-panel)', fontSize: 13.5, fontWeight: 700, opacity: clipBudgetUsed >= CLIP_RULES.maxClips ? 0.45 : 1 }} data-testid="stm-presenter-generate">
                        <Mic size={15} /> Generate a presenter character
                      </button>
                    </div>
                  ) : null}
                  {presenter.status === 'generating' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--space-text-secondary)', fontSize: 13 }}>
                      <Loader2 size={15} className="stm-spin" /> Generating a character image for your approval…
                    </div>
                  ) : null}
                  {presenter.status === 'awaiting-approval' || presenter.status === 'approved' ? (
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {presenter.candidate.imageUrl ? (
                        <img src={presenter.candidate.imageUrl} alt="Presenter character" style={{ width: 132, aspectRatio: '3/4', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--space-border-default)' }} data-testid="stm-presenter-image" />
                      ) : null}
                      <div style={{ flex: '1 1 220px', display: 'grid', gap: 9 }}>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--space-text-secondary)', lineHeight: 1.55 }}>
                          {presenter.candidate.kind === 'stock-look' ? 'Photo-avatar generation is unavailable on this HeyGen plan, so this is the closest stock presenter look.' : 'This character was generated for your brief.'} Approve it and HeyGen renders the presenter during generation; the clip is cut into the timeline on the beat, voice ducking the music.
                        </p>
                        {presenter.status === 'awaiting-approval' ? (
                          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                            <button type="button" className="stm-btn" onClick={() => setPresenter({ status: 'approved', candidate: (presenter as any).candidate })} style={{ minHeight: 40, padding: '0 16px', borderRadius: 11, border: 0, cursor: 'pointer', color: 'var(--space-text-on-primary)', background: 'linear-gradient(135deg,var(--space-brand-primary-500),var(--space-brand-primary-700))', fontWeight: 750, fontSize: 13 }} data-testid="stm-presenter-approve"><Check size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Approve</button>
                            <button type="button" className="stm-btn" onClick={() => void startPresenter()} style={{ minHeight: 40, padding: '0 14px', borderRadius: 11, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-primary)', background: 'var(--space-surface-panel)', fontSize: 13 }}><RefreshCw size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />Regenerate</button>
                            <button type="button" onClick={() => setPresenter({ status: 'off' })} style={{ minHeight: 40, padding: '0 14px', borderRadius: 11, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-secondary)', background: 'var(--space-surface-panel)', fontSize: 13 }}>Skip</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 9 }}>
                            <button type="button" onClick={() => setPresenter({ status: 'off' })} style={{ minHeight: 38, padding: '0 14px', borderRadius: 11, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-secondary)', background: 'var(--space-surface-panel)', fontSize: 13 }}>Remove presenter</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {error ? <div role="alert" style={{ padding: '13px 15px', borderRadius: 13, border: '1px solid color-mix(in srgb,var(--space-semantic-danger-500) 35%,transparent)', background: 'color-mix(in srgb,var(--space-semantic-danger-500) 9%,transparent)', color: 'var(--space-semantic-danger)', fontSize: 13 }}>{error}</div> : null}

            <button type="button" className="stm-btn" disabled={!canGenerate} onClick={() => void generate()} style={{ minHeight: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: 0, borderRadius: 15, cursor: canGenerate ? 'pointer' : 'not-allowed', color: 'var(--space-text-on-primary)', background: canGenerate ? 'linear-gradient(135deg,var(--space-brand-primary-500),var(--space-brand-primary-700))' : 'var(--space-surface-panel-strong)', opacity: canGenerate ? 1 : .55, fontSize: 15, fontWeight: 760 }} data-testid="stm-generate">
              <Sparkles size={18} /> {route === 'mix' ? 'Generate the Presenter Mix' : 'Generate the demo video'}
            </button>
            {route === 'mix' && presenter.status === 'awaiting-approval' ? (
              <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)' }}>Approve (or skip) the presenter character above to enable generation.</div>
            ) : null}
          </section>
        ) : null}

        {stage === 'running' ? (
          <section className="stm-rise" style={{ minHeight: 380, display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 'min(560px,100%)', padding: 'clamp(24px,5vw,40px)', boxSizing: 'border-box', textAlign: 'center', borderRadius: 24, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-card)' }} role="status" aria-live="polite">
              <div style={{ width: 56, height: 56, margin: '0 auto', display: 'grid', placeItems: 'center', borderRadius: 18, color: 'var(--space-text-brand)', background: 'var(--space-surface-accent-soft)' }}><Loader2 size={26} className="stm-spin" /></div>
              <h2 style={{ margin: '18px 0 7px', fontSize: 23 }}>{progress.label}</h2>
              <p style={{ margin: 0, color: 'var(--space-text-secondary)', lineHeight: 1.6 }}>{progress.detail}</p>
              <div style={{ marginTop: 22, height: 7, overflow: 'hidden', borderRadius: 99, background: 'var(--space-surface-panel-strong)' }}>
                <div style={{ width: `${progressPercent}%`, height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,var(--space-brand-primary-600),var(--space-brand-highlight-500))', transition: 'width .5s ease' }} />
              </div>
              <p style={{ margin: '16px 0 0', color: 'var(--space-text-muted)', fontSize: 12 }}>No human in the loop — ingest, conform, gate, analyse, plan, render.</p>
            </div>
          </section>
        ) : null}

        {stage === 'done' && videoUrl ? (
          <section className="stm-rise" style={{ display: 'grid', gap: 16 }}>
            <div style={{ padding: 'clamp(14px,3vw,22px)', borderRadius: 20, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-card)' }}>
              <video src={videoUrl} controls playsInline style={{ width: '100%', display: 'block', borderRadius: 14, background: '#000', aspectRatio: '16/9' }} data-testid="stm-result-video" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--space-semantic-success)', fontSize: 13, fontWeight: 700 }}>
              <Check size={16} /> {plan ? `${plan.scenes.length} scenes · ${Math.round(plan.scenes.reduce((s, x) => s + x.duration, 0) / 30)}s · ${plan.motion} preset${plan.sync ? ` · ${plan.sync.bpm}bpm grid` : ''}` : 'Demo rendered'} — saved to My Videos
            </div>
            {mixNotes.length > 0 ? (
              <div style={{ padding: '12px 15px', borderRadius: 13, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', color: 'var(--space-text-secondary)', fontSize: 12.5, lineHeight: 1.6 }}>
                {mixNotes.map((note, i) => <div key={i}>· {note}</div>)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href={videoUrl} target="_blank" rel="noopener noreferrer" download="screens-to-motion.mp4" className="stm-btn" style={{ minHeight: 52, flex: '1 1 230px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 15, color: 'var(--space-text-on-primary)', background: 'linear-gradient(135deg,var(--space-brand-primary-500),var(--space-brand-primary-700))', textDecoration: 'none', fontWeight: 760 }} data-testid="stm-download"><Download size={18} /> Download MP4</a>
              <button type="button" onClick={reset} className="stm-btn" style={{ minHeight: 52, flex: '1 1 190px', borderRadius: 15, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-primary)', background: 'var(--space-surface-panel)' }}><ArrowLeft size={15} style={{ marginRight: 8, verticalAlign: 'middle' }} />Make another</button>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'videos' } }))} className="stm-btn" style={{ minHeight: 52, flex: '1 1 190px', borderRadius: 15, border: '1px solid var(--space-border-default)', cursor: 'pointer', color: 'var(--space-text-primary)', background: 'var(--space-surface-panel)' }}><Film size={15} style={{ marginRight: 8, verticalAlign: 'middle' }} />Open My Videos</button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
