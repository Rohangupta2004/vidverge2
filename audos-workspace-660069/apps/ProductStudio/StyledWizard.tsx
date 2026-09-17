/**
 * Styled video wizard — the Product Video creation pipeline for all five
 * styles (Clip Style, Cinematic Trailer, Text-to-Video (English),
 * Documentary, Product Showcase). Chosen from the "Choose Style" step of the
 * Create-new-video flow (MyVideos.tsx); rendered full-screen by App.tsx.
 *
 * Seven gated phases — each must be completed before the next appears:
 *   1. Style       pick the look; each style brings its own script strategy,
 *                  image strategy, motion parameters and audio register
 *   2. Product     a URL via the scrape-website hook, or a typed English
 *                  description (Text-to-Video is description-only)
 *   3. Length      15s / 30s / 60s / custom — this sets the SCENE BUDGET
 *   4. Script      Claude writes hook + scenes + CTA, and the customer
 *                  REVIEWS AND APPROVES it here. Nothing is rendered until
 *                  they press Approve.
 *   5. Frames      beats derived from the approved scenes, one image prompt
 *                  each (style lock applied globally, never per line)
 *   6. Sound       ElevenLabs narration, background music, an OPTIONAL
 *                  sound-effects brief, and an OPTIONAL captions toggle —
 *                  all previewable before a frame is rendered
 *   7. Generate    hands the whole run to the clipstyle-run SERVER function:
 *                  frame generation, beat renders, the join and the audio +
 *                  caption finish pass all run server-side and every URL is
 *                  persisted the moment it exists, so the run and its result
 *                  survive tab close. The browser only starts the job and
 *                  polls a status card; reopening the wizard resumes it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clapperboard, Clock,
  Download, FileText, Flame, Gem, Globe, Layers, Loader2, Music, Pencil,
  RefreshCw, Scissors, Sparkles, Type, Volume2, Wand2, X,
} from 'lucide-react';
import { trackB, getWorkspaceToken, resolveSessionId, type ScrapedProductBrief } from '../../lib/trackB/api';
import { countWords } from './clipStyleTemplate';
import {
  DEFAULT_STYLE_ID, VIDEO_STYLES, beatCompositionFor, buildFinishComposition,
  buildSrt, buildStyledImagePrompt, captionCues, getStyle, sceneBudget,
  type VideoStyleId,
} from './videoStyles';
import {
  WORDS_PER_SECOND, beatSceneLabel, beatsFromScript, emptyScript,
  generateBeatPrompts, generateStyledScript, scriptNarration, scriptWordCount,
  suggestMusicPrompt, type StyledBeat, type StyledScript,
} from './scriptWriter';
import {
  byokVerdictNote, generateMusicBed, generateNarration, generateSfxBed,
  listVoices, type GeneratedTrack, type VoiceOption,
} from './audioSuite';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  panelStrong: 'var(--space-surface-panel-strong)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
  success: 'var(--space-semantic-success-500)',
};

/** The server-side styled pipeline — the clipstyle-run server function. */
const CLIPSTYLE_RUN_ENDPOINT = '/api/hooks/execute/workspace-660069/clipstyle-run';

const TOTAL_PHASES = 7;
const PHASE_TITLES = ['Style', 'Your Product', 'Length', 'Script', 'Frames', 'Sound', 'Generate'];

const STYLE_ICONS = { Scissors, Flame, Type, BookOpen, Gem };

interface DurationOption { id: string; label: string; seconds: number | null }
const DURATIONS: DurationOption[] = [
  { id: '15s', label: '15 seconds', seconds: 15 },
  { id: '30s', label: '30 seconds', seconds: 30 },
  { id: '60s', label: '1 minute', seconds: 60 },
  { id: 'custom', label: 'Custom', seconds: null },
];

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 };
const inputStyle: React.CSSProperties = { boxSizing: 'border-box', width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13.5 };
const panelStyle: React.CSSProperties = { borderRadius: 16, border: `1px solid ${S.border}`, background: S.panel, padding: 'clamp(14px, 2.5vw, 20px)', marginBottom: 16 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 11, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13.5, fontWeight: 700 };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' };

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ marginTop: 12, padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: S.danger, background: `color-mix(in srgb, ${S.danger} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${S.danger} 30%, transparent)` }}>
      {message}
    </div>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="ps-btn"
      style={{ position: 'relative', flex: 'none', width: 40, height: 22, borderRadius: 999, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, background: on ? 'var(--space-brand-primary-600)' : S.panelStrong, transition: 'background .15s ease' }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: 999, background: '#fff', transition: 'left .15s ease' }} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Server pipeline plumbing
// ---------------------------------------------------------------------------

interface ServerProject {
  id: number;
  status: 'in_progress' | 'rendered' | 'failed';
  product_name: string | null;
  style: VideoStyleId | null;
  total_beats: number;
  clip_seconds?: number;
  has_finish_audio?: boolean;
  final_video_url: string | null;
  stitched_video_url: string | null;
  srt_text: string | null;
  captions_enabled: boolean | null;
  finish_operation_id: string | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
}

interface ServerClip {
  id: number;
  beat_index: number;
  beat_code: string;
  narration: string | null;
  image_url: string | null;
  video_url: string | null;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  attempts: number;
  error: string | null;
}

type StatusPayload = { project: ServerProject; clips: ServerClip[] };

async function clipStyleRun<T>(payload: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getWorkspaceToken();
  const sessionId = resolveSessionId();
  if (!token || !sessionId) throw new Error('Your verified session is still loading.');
  headers['X-Workspace-DB-Token'] = token;
  headers['X-Session-Id'] = sessionId;
  const res = await fetch(CLIPSTYLE_RUN_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const raw = await res.json().catch(() => null);
  // Hook responses may sit at the top level or under `response`.
  const data = raw && typeof raw === 'object' && ('success' in raw || 'error' in raw) ? raw : (raw?.response ?? raw);
  if (!res.ok || !data || data.success === false || data.error) {
    throw new Error(String(data?.error || `The render service could not be reached (HTTP ${res.status}).`));
  }
  return data as T;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function slug(s: string): string {
  return (s || 'video').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'video';
}

// ---------------------------------------------------------------------------

export default function StyledWizard({ initialStyle, onExit }: { initialStyle?: VideoStyleId; onExit: () => void }) {
  const [phase, setPhase] = useState(initialStyle ? 2 : 1);
  const [styleId, setStyleId] = useState<VideoStyleId>(initialStyle ?? DEFAULT_STYLE_ID);
  const style = useMemo(() => getStyle(styleId), [styleId]);

  // Phase 2 — product input
  const [inputMode, setInputMode] = useState<'url' | 'manual'>(style.allowsUrl ? 'url' : 'manual');
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [brief, setBrief] = useState<ScrapedProductBrief | null>(null);
  const [manualDesc, setManualDesc] = useState('');
  const [productError, setProductError] = useState<string | null>(null);

  // Phase 3 — length
  const [durationId, setDurationId] = useState('30s');
  const [customSeconds, setCustomSeconds] = useState('45');

  // Phase 4 — script + the approval gate
  const [script, setScript] = useState<StyledScript>(emptyScript);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptApproved, setScriptApproved] = useState(false);
  const [steer, setSteer] = useState('');

  // Phase 5 — beats + image prompts
  const [beats, setBeats] = useState<StyledBeat[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [promptsBusy, setPromptsBusy] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [styleLockOpen, setStyleLockOpen] = useState(false);

  // Phase 6 — sound
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [narrationOn, setNarrationOn] = useState(true);
  const [narrationUrl, setNarrationUrl] = useState('');
  const [musicOn, setMusicOn] = useState(true);
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicTrack, setMusicTrack] = useState<GeneratedTrack | null>(null);
  const [sfxPrompt, setSfxPrompt] = useState('');
  const [sfxTrack, setSfxTrack] = useState<GeneratedTrack | null>(null);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [soundBusy, setSoundBusy] = useState<'' | 'narration' | 'music' | 'sfx'>('');
  const [soundNote, setSoundNote] = useState('');
  const [soundError, setSoundError] = useState<string | null>(null);

  // Phase 7 — generation (server-driven)
  const [project, setProject] = useState<ServerProject | null>(null);
  const [clips, setClips] = useState<ServerClip[]>([]);
  const [starting, setStarting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState<number | null>(null); // beat_index, -1 join, -2 audio

  const targetSeconds = durationId === 'custom'
    ? Math.min(600, Math.max(10, Math.round(Number(customSeconds) || 0)))
    : (DURATIONS.find((d) => d.id === durationId)?.seconds ?? 30);
  const budget = sceneBudget(targetSeconds);
  const targetWords = Math.max(12, Math.round(targetSeconds * WORDS_PER_SECOND));

  // Text-to-Video is description-only: its whole point is generating from the
  // customer's own English words, so the URL tab never applies to it.
  useEffect(() => {
    if (!style.allowsUrl && inputMode !== 'manual') setInputMode('manual');
  }, [style.allowsUrl, inputMode]);

  /**
   * What the writer is briefed on. The chosen INPUT MODE decides this, not
   * whichever source happens to be filled — a customer who fetched a URL and
   * then switched to "Describe it" means the description, and reading the
   * stale scrape instead was why the typed-description path produced a video
   * about something else entirely.
   */
  const productContext = useCallback((): string => {
    if (inputMode === 'manual') return manualDesc.trim();
    if (!brief) return '';
    const parts: string[] = [];
    if (brief.product_name) parts.push('Product: ' + brief.product_name);
    if (brief.tagline) parts.push('Tagline: ' + brief.tagline);
    if (Array.isArray(brief.key_features) && brief.key_features.length) parts.push('Key features: ' + brief.key_features.slice(0, 6).join('; '));
    if (Array.isArray(brief.pain_points_addressed) && brief.pain_points_addressed.length) parts.push('Problems it solves: ' + brief.pain_points_addressed.slice(0, 4).join('; '));
    if (Array.isArray(brief.unique_differentiators) && brief.unique_differentiators.length) parts.push('Differentiators: ' + brief.unique_differentiators.slice(0, 3).join('; '));
    if (brief.tone) parts.push('Tone: ' + brief.tone);
    return parts.join('\n');
  }, [inputMode, brief, manualDesc]);

  const productName = (inputMode === 'url' && brief?.product_name)
    || script.title
    || manualDesc.trim().split(/\s+/).slice(0, 5).join(' ')
    || 'this product';

  const productReady = inputMode === 'url' ? !!brief : countWords(manualDesc) >= 5;

  // -------------------------------------------------------------------------
  // Phase 2 — product intake
  // -------------------------------------------------------------------------
  const fetchProduct = useCallback(async () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) { setProductError('Enter a full URL starting with https://'); return; }
    setProductError(null);
    setScraping(true);
    try {
      const res = await trackB.scrapeWebsite(u);
      if (!res || res.success === false || !res.product_name) {
        throw new Error(res?.error || 'The product page could not be read — try the manual description instead.');
      }
      setBrief(res);
    } catch (e) {
      setBrief(null);
      setProductError(e instanceof Error ? e.message : 'The product page could not be read.');
    } finally {
      setScraping(false);
    }
  }, [url]);

  // -------------------------------------------------------------------------
  // Phase 4 — script
  // -------------------------------------------------------------------------
  const writeScript = useCallback(async (withSteer?: string) => {
    setScriptError(null);
    setScriptBusy(true);
    setScriptApproved(false);
    try {
      const next = await generateStyledScript({
        style,
        productContext: productContext(),
        targetSeconds,
        fromDescription: inputMode === 'manual',
        steer: withSteer,
      });
      setScript(next);
      setBeats([]);
      setPrompts([]);
      setNarrationUrl('');
      setMusicTrack(null);
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'The script could not be written — try again.');
    } finally {
      setScriptBusy(false);
    }
  }, [style, productContext, targetSeconds, inputMode]);

  // Write the script the first time Phase 4 opens.
  useEffect(() => {
    if (phase === 4 && !script.scenes.length && !scriptBusy && !scriptError) void writeScript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const updateScene = useCallback((i: number, patch: { visual?: string; voiceover?: string }) => {
    setScriptApproved(false);
    setScript((cur) => ({ ...cur, scenes: cur.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }, []);

  const approveScript = useCallback(() => {
    setBeats(beatsFromScript(script, style));
    setPrompts([]);
    setScriptApproved(true);
    setPhase(5);
  }, [script, style]);

  // -------------------------------------------------------------------------
  // Phase 5 — image prompts
  // -------------------------------------------------------------------------
  const writePrompts = useCallback(async () => {
    setPromptsError(null);
    setPromptsBusy(true);
    try {
      setPrompts(await generateBeatPrompts(style, beats, productContext()));
    } catch (e) {
      setPromptsError(e instanceof Error ? e.message : 'The frame prompts could not be written — try again.');
    } finally {
      setPromptsBusy(false);
    }
  }, [style, beats, productContext]);

  useEffect(() => {
    if (phase === 5 && beats.length && !prompts.length && !promptsBusy && !promptsError) void writePrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, beats.length]);

  // -------------------------------------------------------------------------
  // Phase 6 — sound
  // -------------------------------------------------------------------------
  const narration = useMemo(() => scriptNarration(script, style), [script, style]);
  const filmSeconds = beats.length * style.clipSeconds;

  useEffect(() => {
    if (phase !== 6) return;
    if (!musicPrompt) {
      void suggestMusicPrompt(style, narration).then((p) => setMusicPrompt((cur) => cur || p));
    }
    if (!voices.length) {
      void listVoices().then((v) => {
        setVoices(v);
        setVoiceId((cur) => cur || (v[0]?.id ?? ''));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const makeNarration = useCallback(async () => {
    setSoundError(null);
    setSoundBusy('narration');
    try {
      const res = await generateNarration(narration, voiceId || null, setSoundNote);
      setNarrationUrl(res.url);
    } catch (e) {
      setSoundError(e instanceof Error ? e.message : 'The narration could not be recorded.');
    } finally {
      setSoundBusy('');
      setSoundNote('');
    }
  }, [narration, voiceId]);

  const makeMusic = useCallback(async () => {
    setSoundError(null);
    setSoundBusy('music');
    try {
      setMusicTrack(await generateMusicBed(musicPrompt, filmSeconds, setSoundNote));
    } catch (e) {
      setSoundError(e instanceof Error ? e.message : 'The music could not be generated.');
    } finally {
      setSoundBusy('');
      setSoundNote('');
    }
  }, [musicPrompt, filmSeconds]);

  const makeSfx = useCallback(async () => {
    setSoundError(null);
    setSoundBusy('sfx');
    try {
      setSfxTrack(await generateSfxBed(sfxPrompt, filmSeconds, setSoundNote));
    } catch (e) {
      setSoundError(e instanceof Error ? e.message : 'The sound effects could not be generated.');
    } finally {
      setSoundBusy('');
      setSoundNote('');
    }
  }, [sfxPrompt, filmSeconds]);

  // -------------------------------------------------------------------------
  // Phase 7 — server-driven generation
  // -------------------------------------------------------------------------

  // Catch-up on mount: an in-flight (or recently failed) run is adopted so a
  // customer who closed the tab mid-render lands straight on the status card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await clipStyleRun<{ projects: ServerProject[] }>({ op: 'list' });
        if (cancelled) return;
        const rows = res.projects || [];
        const live = rows.find((p) => p.status === 'in_progress');
        const newest = rows[0];
        const dayMs = 24 * 60 * 60 * 1000;
        const recent = (p: ServerProject) => Date.now() - new Date(p.updated_at || p.created_at || 0).getTime() < dayMs;
        const adopt = live || (newest && newest.status === 'failed' && recent(newest) ? newest : null);
        if (!adopt) return;
        const st = await clipStyleRun<StatusPayload>({ op: 'status', project_id: adopt.id });
        if (cancelled) return;
        setProject(st.project);
        setClips(st.clips || []);
      } catch {
        /* no session yet or nothing to resume — the wizard starts fresh */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll the run while it is in progress. The server-side chain does the real
  // work; this only refreshes the card (and revives an orphaned chain).
  useEffect(() => {
    if (!project || project.status !== 'in_progress') return;
    let stopped = false;
    const poll = async () => {
      try {
        const st = await clipStyleRun<StatusPayload>({ op: 'status', project_id: project.id });
        if (stopped) return;
        setProject(st.project);
        setClips(st.clips || []);
      } catch { /* the next interval retries */ }
    };
    const timer = window.setInterval(() => { void poll(); }, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.status]);

  const startGeneration = useCallback(async () => {
    setGenError(null);
    setStarting(true);
    try {
      const cues = captionCues(beats.map((b) => b.text), style.clipSeconds);
      const res = await clipStyleRun<StatusPayload>({
        op: 'start',
        project_key: 'cs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        style: style.id,
        product_name: productName,
        script: narration,
        target_seconds: targetSeconds,
        beats: beats.map((b) => ({ code: b.code, text: b.text })),
        prompts: prompts.map((p) => buildStyledImagePrompt(style, p)),
        composition_tsx: beatCompositionFor(style),
        finish_tsx: buildFinishComposition(style.captionLook, Math.round(style.clipSeconds * 30)),
        narration_url: narrationOn ? narrationUrl : '',
        music_url: musicOn && musicTrack ? musicTrack.url : '',
        music_prompt: musicOn ? musicPrompt : '',
        sfx_url: sfxTrack ? sfxTrack.url : '',
        sfx_prompt: sfxPrompt.trim(),
        captions: captionsOn,
        srt_text: captionsOn ? buildSrt(cues) : '',
      });
      setProject(res.project);
      setClips(res.clips || []);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'The render could not be started — try again.');
    } finally {
      setStarting(false);
    }
  }, [beats, prompts, style, productName, narration, targetSeconds, narrationOn, narrationUrl, musicOn, musicTrack, musicPrompt, sfxTrack, sfxPrompt, captionsOn]);

  const runOp = useCallback(async (op: string, busyKey: number, extra?: Record<string, unknown>) => {
    if (!project) return;
    setGenError(null);
    setRetryBusy(busyKey);
    try {
      const res = await clipStyleRun<StatusPayload>({ op, project_id: project.id, ...(extra || {}) });
      setProject(res.project);
      setClips(res.clips || []);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'The retry could not be started.');
    } finally {
      setRetryBusy(null);
    }
  }, [project]);

  const startNewVideo = useCallback(() => {
    setProject(null);
    setClips([]);
    setGenError(null);
    setScript(emptyScript());
    setScriptApproved(false);
    setBeats([]);
    setPrompts([]);
    setNarrationUrl('');
    setMusicTrack(null);
    setSfxTrack(null);
    setPhase(1);
  }, []);

  // -------------------------------------------------------------------------
  // Phase gating
  // -------------------------------------------------------------------------
  const canContinue =
    phase === 1 ? true :
    phase === 2 ? productReady :
    phase === 3 ? targetSeconds >= 10 :
    phase === 4 ? false : // Phase 4 advances only through Approve
    phase === 5 ? prompts.length === beats.length && prompts.every((p) => countWords(p) >= 5) && !promptsBusy :
    phase === 6 ? true :
    false;

  const goBack = () => setPhase((p) => Math.max(1, p - 1));
  const goNext = () => setPhase((p) => Math.min(TOTAL_PHASES, p + 1));

  // -------------------------------------------------------------------------
  // The status card (an active or finished run)
  // -------------------------------------------------------------------------
  if (project) {
    const runStyle = getStyle(project.style);
    const doneClips = clips.filter((c) => c.status === 'done');
    const failedClips = clips.filter((c) => c.status === 'failed');
    const allClipsDone = clips.length > 0 && doneClips.length === clips.length;
    const joinFailed = project.status === 'failed' && allClipsDone && !project.stitched_video_url;
    const inAudioPass = project.status === 'in_progress' && !!project.stitched_video_url;
    const chip =
      project.status === 'rendered' ? { label: 'Ready', color: S.success } :
      project.status === 'failed' ? { label: 'Needs attention', color: S.danger } :
      inAudioPass ? { label: 'Adding the sound', color: S.brand } :
      { label: `Rendering ${doneClips.length} / ${clips.length || project.total_beats}`, color: S.brand };

    return (
      <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(14px, 3vw, 28px)', color: S.text, boxSizing: 'border-box' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" onClick={onExit} className="ps-btn" style={ghostBtn} data-testid="button-wizard-status-exit">
            <ArrowLeft size={13} /> My Videos
          </button>
          <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 'clamp(17px, 2.6vw, 22px)', fontWeight: 800 }}>
            <Clapperboard size={19} color="var(--space-text-brand)" /> {runStyle.name}
          </h1>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, border: `1px solid color-mix(in srgb, ${chip.color} 40%, transparent)`, background: `color-mix(in srgb, ${chip.color} 12%, transparent)`, fontSize: 12, fontWeight: 800, color: chip.color }} data-testid="chip-wizard-status">
            {project.status === 'in_progress' ? <Loader2 size={12} className="rc-spin" /> : project.status === 'rendered' ? <Check size={12} /> : <X size={12} />}
            {chip.label}
          </span>
        </header>

        <section style={panelStyle} data-testid="panel-wizard-progress">
          <span style={labelStyle}>
            <Clapperboard size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            {project.product_name || 'Your video'}
          </span>

          {project.status === 'in_progress' ? (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: S.brand }} data-testid="status-wizard-running">
              <Loader2 size={14} className="rc-spin" />
              {inAudioPass
                ? 'Every clip is rendered and joined. Laying the narration, music and sound effects over the film now — this is the last step.'
                : `Rendering ${doneClips.length} of ${clips.length || project.total_beats} clips on our servers — you can close this tab and come back any time. Every clip is saved the moment it finishes.`}
            </p>
          ) : null}

          {project.status === 'rendered' && project.final_video_url ? (
            <div className="ps-fade-up" style={{ marginBottom: 14 }} data-testid="panel-wizard-final">
              <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', fontSize: 13.5, fontWeight: 800, color: S.success }}>
                <Check size={15} /> Your {runStyle.name} video is ready, and it is saved to Saved Videos.
              </p>
              <video src={project.final_video_url} controls playsInline style={{ display: 'block', width: '100%', maxWidth: 640, borderRadius: 14, border: `1px solid ${S.borderStrong}`, background: '#000' }} data-testid="video-wizard-final" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <a href={project.final_video_url} download target="_blank" rel="noreferrer" className="ps-btn" style={primaryBtn} data-testid="link-wizard-download">
                  <Download size={14} /> Download video
                </a>
                {project.captions_enabled && project.srt_text ? (
                  <button type="button" onClick={() => downloadText(slug(project.product_name || 'video') + '.srt', project.srt_text as string)} className="ps-btn" style={ghostBtn} data-testid="button-wizard-srt">
                    <FileText size={13} /> Download .srt captions
                  </button>
                ) : null}
                {project.has_finish_audio ? (
                  <button type="button" onClick={() => void runOp('refinish', -2, { finish_tsx: buildFinishComposition(runStyle.captionLook, Math.round(runStyle.clipSeconds * 30)) })} disabled={retryBusy !== null} className="ps-btn" style={{ ...ghostBtn, opacity: retryBusy !== null ? 0.6 : 1 }} data-testid="button-wizard-refinish">
                    {retryBusy === -2 ? <Loader2 size={13} className="rc-spin" /> : <Volume2 size={13} />} Redo the sound pass
                  </button>
                ) : null}
                <button type="button" onClick={startNewVideo} className="ps-btn" style={ghostBtn} data-testid="button-wizard-new">
                  <Sparkles size={13} /> Start another video
                </button>
              </div>
            </div>
          ) : null}

          {project.status === 'failed' ? (
            <div style={{ marginBottom: 14 }} data-testid="panel-wizard-failed">
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: S.danger, lineHeight: 1.6 }}>{project.error || 'The render needs attention.'}</p>
              {joinFailed ? (
                <button type="button" onClick={() => void runOp('restitch', -1, { finish_tsx: buildFinishComposition(runStyle.captionLook, Math.round(runStyle.clipSeconds * 30)) })} disabled={retryBusy !== null} className="ps-btn" style={{ ...ghostBtn, opacity: retryBusy !== null ? 0.6 : 1 }} data-testid="button-restitch">
                  {retryBusy === -1 ? <Loader2 size={13} className="rc-spin" /> : <RefreshCw size={13} />} Retry join
                </button>
              ) : failedClips.length ? (
                <p style={{ margin: 0, fontSize: 12.5, color: S.sub }}>Retry the failed beats below — every finished clip is already saved.</p>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            {clips.map((c) => {
              const stateLabel =
                c.status === 'done' ? 'clip ready' :
                c.status === 'failed' ? (c.error || 'failed') :
                c.status === 'rendering' ? 'animating…' :
                c.image_url ? 'frame ready — waiting to animate' : 'drawing the frame…';
              return (
                <div key={c.beat_code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 11, border: `1px solid ${c.status === 'failed' ? `color-mix(in srgb, ${S.danger} 40%, transparent)` : S.border}`, background: S.card, flexWrap: 'wrap' }} data-testid={`gen-row-${c.beat_code}`}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: S.brand, width: 42 }}>{c.beat_code}</span>
                  {c.image_url ? <img src={c.image_url} alt={`${c.beat_code} frame`} style={{ width: 52, height: 30, objectFit: 'cover', borderRadius: 6, border: `1px solid ${S.border}` }} /> : <span style={{ width: 52, height: 30, borderRadius: 6, background: S.panelStrong, display: 'inline-block' }} />}
                  <span style={{ flex: 1, minWidth: 140, fontSize: 12, color: c.status === 'failed' ? S.danger : S.sub, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {c.status === 'done' ? <Check size={12} color={S.success} /> : c.status === 'failed' ? <X size={12} /> : <Loader2 size={12} className="rc-spin" />}
                    {stateLabel}
                  </span>
                  {c.video_url ? (
                    <a href={c.video_url} target="_blank" rel="noreferrer" className="ps-btn" style={{ ...ghostBtn, padding: '5px 10px', fontSize: 11.5 }} data-testid={`link-clip-${c.beat_code}`}>
                      <Download size={11} /> Clip
                    </a>
                  ) : null}
                  {c.status === 'failed' ? (
                    <button type="button" onClick={() => void runOp('retry_clip', c.beat_index, { beat_index: c.beat_index })} disabled={retryBusy !== null} className="ps-btn" style={{ ...ghostBtn, padding: '5px 10px', fontSize: 11.5, opacity: retryBusy !== null ? 0.6 : 1 }} data-testid={`button-retry-${c.beat_code}`}>
                      {retryBusy === c.beat_index ? <Loader2 size={11} className="rc-spin" /> : <RefreshCw size={11} />} Retry
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <ErrorBanner message={genError} />
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // The phased wizard
  // -------------------------------------------------------------------------
  const StyleIcon = STYLE_ICONS[style.icon];

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(14px, 3vw, 28px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" onClick={onExit} className="ps-btn" style={ghostBtn} data-testid="button-wizard-exit">
          <ArrowLeft size={13} /> My Videos
        </button>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 'clamp(17px, 2.6vw, 22px)', fontWeight: 800 }}>
          <StyleIcon size={19} color="var(--space-text-brand)" /> {style.name}
        </h1>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, border: `1px solid ${S.border}`, background: S.panelStrong, fontSize: 12, fontWeight: 800, color: S.brand }} data-testid="chip-wizard-phase">
          Step {phase} of {TOTAL_PHASES}
        </span>
      </header>

      {/* Phase indicator rail */}
      <div className="ps-scroll-x" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }} aria-label="Pipeline steps">
        {PHASE_TITLES.map((t, i) => {
          const n = i + 1;
          const state = n < phase ? 'done' : n === phase ? 'active' : 'todo';
          return (
            <span key={t} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: state === 'active' ? 'var(--space-text-on-primary)' : state === 'done' ? S.success : S.muted, background: state === 'active' ? 'var(--space-brand-primary-600)' : S.card, border: `1px solid ${state === 'active' ? 'var(--space-brand-primary-600)' : S.border}` }} data-testid={`phase-pill-${n}`}>
              {state === 'done' ? <Check size={11} /> : null}
              {n}. {t}
            </span>
          );
        })}
      </div>

      {/* ---------------- Phase 1 — Style ---------------- */}
      {phase === 1 ? (
        <section style={panelStyle} data-testid="panel-wizard-style">
          <span style={labelStyle}>Choose the style of your video</span>
          <div role="radiogroup" aria-label="Video style" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
            {VIDEO_STYLES.map((s) => {
              const Icon = STYLE_ICONS[s.icon];
              const active = styleId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => { setStyleId(s.id); setScript(emptyScript()); setScriptApproved(false); setBeats([]); setPrompts([]); setMusicPrompt(''); setMusicTrack(null); setNarrationUrl(''); }}
                  className="ps-btn"
                  style={{ padding: '13px 14px', borderRadius: 13, textAlign: 'left', border: `1px solid ${active ? 'var(--space-brand-primary-600)' : S.border}`, background: active ? 'color-mix(in srgb, var(--space-brand-primary-600) 14%, transparent)' : S.card, color: S.text, cursor: 'pointer' }}
                  data-testid={`option-style-${s.id}`}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800 }}>
                    <Icon size={14} color="var(--space-text-brand)" /> {s.name}
                  </span>
                  <span style={{ display: 'block', marginTop: 5, fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>{s.blurb}</span>
                  <span style={{ display: 'block', marginTop: 7, fontSize: 10.5, color: S.sub, fontWeight: 700 }}>
                    {s.clipSeconds}s shots · {s.allowsUrl ? 'URL or description' : 'description only'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ---------------- Phase 2 — Product ---------------- */}
      {phase === 2 ? (
        <section style={panelStyle} data-testid="panel-wizard-product">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>{style.allowsUrl ? 'Your product' : 'Describe the video you want'}</span>
            {style.allowsUrl ? (
              <div role="radiogroup" aria-label="Product input mode" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: `1px solid ${S.border}`, background: S.panelStrong }}>
                {(['url', 'manual'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={inputMode === m} onClick={() => { setInputMode(m); setScript(emptyScript()); setScriptApproved(false); setBeats([]); setPrompts([]); }} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, border: 'none', background: inputMode === m ? 'var(--space-brand-primary-600)' : 'transparent', color: inputMode === m ? 'var(--space-text-on-primary)' : S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }} data-testid={`tab-wizard-${m}`}>
                    {m === 'url' ? <Globe size={13} /> : <Pencil size={13} />} {m === 'url' ? 'Paste a URL' : 'Describe it'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {inputMode === 'url' ? (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={url} onChange={(e) => { setUrl(e.currentTarget.value); setBrief(null); }} placeholder="https://yourproduct.com" className="ps-input" style={{ ...inputStyle, flex: '1 1 260px' }} data-testid="input-wizard-url" />
                <button type="button" onClick={() => void fetchProduct()} disabled={scraping} className="ps-btn" style={{ ...primaryBtn, opacity: scraping ? 0.6 : 1 }} data-testid="button-wizard-fetch">
                  {scraping ? <Loader2 size={14} className="rc-spin" /> : <Sparkles size={14} />}
                  {scraping ? 'Reading the page…' : 'Fetch product details'}
                </button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted }}>The page is read once to pull the product name, tagline and features.</p>
            </div>
          ) : (
            <div>
              <textarea
                value={manualDesc}
                onChange={(e) => { setManualDesc(e.currentTarget.value); setScriptApproved(false); }}
                rows={6}
                maxLength={2000}
                placeholder={style.id === 'text2video'
                  ? 'Describe the video you want in plain English. What happens, who or what is in it, where it is set, and how it should feel. The AI generates directly from your words.'
                  : 'What is the product, who is it for, and what does it do? A few sentences is plenty.'}
                className="ps-input"
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
                data-testid="input-wizard-manual"
              />
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted }}>
                {countWords(manualDesc)} words · your description is the brief AND the creative direction — the script follows what you wrote.
              </p>
            </div>
          )}

          {productReady ? (
            <div className="ps-fade-up" style={{ marginTop: 14, borderRadius: 12, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 14 }} data-testid="card-wizard-summary">
              <span style={{ ...labelStyle, marginBottom: 8 }}>Confirm what the video is about</span>
              {inputMode === 'url' && brief ? (
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>{brief.product_name}</p>
                  {brief.tagline ? <p style={{ margin: '0 0 8px', fontSize: 13, color: S.sub }}>{brief.tagline}</p> : null}
                  {Array.isArray(brief.key_features) && brief.key_features.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: S.sub, lineHeight: 1.6 }}>
                      {brief.key_features.slice(0, 5).map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: S.sub, lineHeight: 1.6 }}>{manualDesc.trim()}</p>
              )}
            </div>
          ) : null}
          <ErrorBanner message={productError} />
        </section>
      ) : null}

      {/* ---------------- Phase 3 — Length ---------------- */}
      {phase === 3 ? (
        <section style={panelStyle} data-testid="panel-wizard-length">
          <span style={labelStyle}>How long should the video run?</span>
          <div role="radiogroup" aria-label="Video length" style={{ display: 'grid', gap: 8 }}>
            {DURATIONS.map((opt) => {
              const active = durationId === opt.id;
              const b = opt.seconds ? sceneBudget(opt.seconds) : null;
              return (
                <button key={opt.id} type="button" role="radio" aria-checked={active} onClick={() => { setDurationId(opt.id); setScriptApproved(false); }} className="ps-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, textAlign: 'left', border: `1px solid ${active ? 'var(--space-brand-primary-600)' : S.border}`, background: active ? 'color-mix(in srgb, var(--space-brand-primary-600) 14%, transparent)' : S.card, color: S.text, cursor: 'pointer' }} data-testid={`option-duration-${opt.id}`}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{opt.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: S.muted }}>
                    {b ? `${b.min}–${b.max} scenes` : 'type your own target'}
                  </span>
                </button>
              );
            })}
          </div>
          {durationId === 'custom' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <label htmlFor="wizard-custom-seconds" style={{ ...labelStyle, marginBottom: 0 }}>Target length (seconds)</label>
              <input id="wizard-custom-seconds" value={customSeconds} onChange={(e) => setCustomSeconds(e.currentTarget.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="ps-input" style={{ ...inputStyle, width: 110 }} data-testid="input-duration-custom" />
              <span style={{ fontSize: 12, color: S.muted }}>{budget.min}–{budget.max} scenes · ≈ {targetWords} words</span>
            </div>
          ) : null}
          <p style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '14px 0 0', fontSize: 12, color: S.muted, lineHeight: 1.5 }}>
            <Clock size={13} />
            The length sets the scene budget: {budget.min}–{budget.max} scenes, about {targetWords} spoken words. Every {style.name} shot runs {style.clipSeconds} seconds.
          </p>
        </section>
      ) : null}

      {/* ---------------- Phase 4 — Script + approval gate ---------------- */}
      {phase === 4 ? (
        <section style={panelStyle} data-testid="panel-wizard-script">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}><FileText size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Review your script</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: S.muted }} data-testid="chip-script-words">
                {scriptWordCount(script, style)} / ~{targetWords} words · {script.scenes.length} scenes
              </span>
              <button type="button" onClick={() => void writeScript(steer.trim() || undefined)} disabled={scriptBusy} className="ps-btn" style={{ ...ghostBtn, opacity: scriptBusy ? 0.6 : 1 }} data-testid="button-script-regenerate">
                {scriptBusy ? <Loader2 size={13} className="rc-spin" /> : <RefreshCw size={13} />}
                {scriptBusy ? 'Writing…' : script.scenes.length ? 'Rewrite' : 'Write the script'}
              </button>
            </div>
          </div>

          {scriptBusy && !script.scenes.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: '18px 0' }}>
              <Loader2 size={14} className="rc-spin" /> Claude is writing a {style.name.toLowerCase()} script for {productName}…
            </div>
          ) : script.scenes.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ borderRadius: 12, border: `1px solid color-mix(in srgb, var(--space-brand-primary-600) 40%, transparent)`, background: 'color-mix(in srgb, var(--space-brand-primary-600) 8%, transparent)', padding: '11px 13px' }} data-testid="card-script-hook">
                <span style={{ ...labelStyle, marginBottom: 6 }}>Hook · the first three seconds</span>
                <textarea value={script.hook} onChange={(e) => { setScriptApproved(false); setScript((c) => ({ ...c, hook: e.currentTarget.value })); }} rows={2} className="ps-input" style={{ ...inputStyle, fontSize: 14, fontWeight: 700, lineHeight: 1.5, resize: 'vertical' }} data-testid="input-script-hook" />
              </div>

              {script.scenes.map((sc, i) => (
                <div key={i} style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: '11px 13px' }} data-testid={`card-script-scene-${i}`}>
                  <span style={{ ...labelStyle, marginBottom: 6 }}>Scene {i + 1}</span>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: S.brand, marginBottom: 4 }}>What you see</label>
                  <textarea value={sc.visual} onChange={(e) => updateScene(i, { visual: e.currentTarget.value })} rows={2} className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical', marginBottom: 8 }} data-testid={`input-scene-visual-${i}`} />
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: S.brand, marginBottom: 4 }}>What the voice says</label>
                  <textarea value={sc.voiceover} onChange={(e) => updateScene(i, { voiceover: e.currentTarget.value })} rows={2} className="ps-input" style={{ ...inputStyle, fontSize: 13, lineHeight: 1.55, resize: 'vertical' }} data-testid={`input-scene-vo-${i}`} />
                </div>
              ))}

              <div style={{ borderRadius: 12, border: `1px solid color-mix(in srgb, ${S.success} 40%, transparent)`, background: `color-mix(in srgb, ${S.success} 8%, transparent)`, padding: '11px 13px' }} data-testid="card-script-cta">
                <span style={{ ...labelStyle, marginBottom: 6 }}>Call to action · the closing line</span>
                <textarea value={script.cta} onChange={(e) => { setScriptApproved(false); setScript((c) => ({ ...c, cta: e.currentTarget.value })); }} rows={2} className="ps-input" style={{ ...inputStyle, fontSize: 13.5, fontWeight: 700, lineHeight: 1.5, resize: 'vertical' }} data-testid="input-script-cta" />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={steer} onChange={(e) => setSteer(e.currentTarget.value)} placeholder="Want it different? Tell Claude what to change, then Rewrite." className="ps-input" style={{ ...inputStyle, flex: '1 1 240px', fontSize: 12.5 }} data-testid="input-script-steer" />
              </div>

              <div style={{ borderRadius: 12, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }} data-testid="panel-script-approve">
                <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: S.sub, lineHeight: 1.55 }}>
                  Nothing is rendered until you approve. Edit any line above, then approve to turn these scenes into shots.
                </span>
                <button type="button" onClick={approveScript} disabled={scriptBusy || !script.scenes.length} className="ps-btn" style={{ ...primaryBtn, padding: '11px 20px', opacity: scriptBusy ? 0.6 : 1 }} data-testid="button-script-approve">
                  <Check size={14} /> Approve script
                </button>
              </div>
            </div>
          ) : null}
          <ErrorBanner message={scriptError} />
        </section>
      ) : null}

      {/* ---------------- Phase 5 — Frames ---------------- */}
      {phase === 5 ? (
        <section style={panelStyle} data-testid="panel-wizard-frames">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>
              <Layers size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {beats.length} shots · {style.clipSeconds}s each ≈ {Math.round(beats.length * style.clipSeconds)}s
            </span>
            <button type="button" onClick={() => void writePrompts()} disabled={promptsBusy} className="ps-btn" style={{ ...ghostBtn, opacity: promptsBusy ? 0.6 : 1 }} data-testid="button-prompts-regenerate">
              {promptsBusy ? <Loader2 size={13} className="rc-spin" /> : <RefreshCw size={13} />}
              {promptsBusy ? 'Writing…' : 'Regenerate all'}
            </button>
          </div>

          <button type="button" onClick={() => setStyleLockOpen((v) => !v)} className="ps-btn" style={{ ...ghostBtn, width: '100%', justifyContent: 'space-between', marginBottom: 10 }} aria-expanded={styleLockOpen} data-testid="button-stylelock-toggle">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Wand2 size={13} /> STYLE LOCK — applied to every frame automatically</span>
            <ChevronDown size={14} style={{ transform: styleLockOpen ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }} />
          </button>
          {styleLockOpen ? (
            <div className="ps-fade-up" style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, marginBottom: 12, fontSize: 12, color: S.sub, lineHeight: 1.6, whiteSpace: 'pre-wrap' }} data-testid="panel-stylelock">
              {'STYLE LOCK\n' + style.styleLock + '\n\nNEGATIVE\n' + style.negative + '\n\nMOTION\n' + style.animationNote}
            </div>
          ) : null}

          {promptsBusy && !prompts.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: '18px 0' }}>
              <Loader2 size={14} className="rc-spin" /> Writing {beats.length} frame prompts…
            </div>
          ) : prompts.length ? (
            <div style={{ display: 'grid', gap: 9 }}>
              {beats.map((b, i) => (
                <div key={b.code} style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: '10px 12px' }} data-testid={`prompt-row-${b.code}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: S.brand }}>[{b.code}]</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: S.panelStrong, color: S.muted }}>{beatSceneLabel(b)}</span>
                    <span style={{ fontSize: 11, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 100 }}>{b.text}</span>
                    <span style={{ fontSize: 10.5, color: countWords(prompts[i]) < 25 || countWords(prompts[i]) > 44 ? '#fbbf24' : S.muted }}>{countWords(prompts[i])} words</span>
                  </div>
                  <textarea value={prompts[i]} onChange={(e) => setPrompts((cur) => cur.map((p, j) => (j === i ? e.currentTarget.value : p)))} rows={2} className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.55, resize: 'vertical' }} data-testid={`input-prompt-${b.code}`} />
                </div>
              ))}
            </div>
          ) : null}
          <ErrorBanner message={promptsError} />
        </section>
      ) : null}

      {/* ---------------- Phase 6 — Sound ---------------- */}
      {phase === 6 ? (
        <section style={panelStyle} data-testid="panel-wizard-sound">
          <span style={labelStyle}><Volume2 size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Sound — generated by ElevenLabs</span>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: S.muted, lineHeight: 1.55 }}>
            Preview everything here before a single frame is rendered. Whatever you generate is mixed over the finished film in one final pass.
          </p>

          {/* Narration */}
          <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, marginBottom: 10 }} data-testid="card-sound-narration">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Toggle on={narrationOn} onChange={setNarrationOn} label="Add narration" />
              <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 700 }}>Narration voice</span>
              {voices.length ? (
                <select value={voiceId} onChange={(e) => { setVoiceId(e.currentTarget.value); setNarrationUrl(''); }} className="ps-input" style={{ ...inputStyle, width: 'auto', fontSize: 12.5, padding: '7px 10px' }} data-testid="select-voice">
                  {voices.slice(0, 40).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              ) : null}
              <button type="button" onClick={() => void makeNarration()} disabled={!narrationOn || soundBusy !== ''} className="ps-btn" style={{ ...ghostBtn, opacity: !narrationOn || soundBusy !== '' ? 0.55 : 1 }} data-testid="button-generate-narration">
                {soundBusy === 'narration' ? <Loader2 size={13} className="rc-spin" /> : <Volume2 size={13} />}
                {narrationUrl ? 'Re-record' : 'Record narration'}
              </button>
            </div>
            {narrationUrl ? <audio src={narrationUrl} controls style={{ width: '100%', marginTop: 10, height: 34 }} data-testid="audio-narration" /> : null}
          </div>

          {/* Music */}
          <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, marginBottom: 10 }} data-testid="card-sound-music">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <Toggle on={musicOn} onChange={setMusicOn} label="Add background music" />
              <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 700 }}><Music size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Background music</span>
              <button type="button" onClick={() => void makeMusic()} disabled={!musicOn || soundBusy !== ''} className="ps-btn" style={{ ...ghostBtn, opacity: !musicOn || soundBusy !== '' ? 0.55 : 1 }} data-testid="button-generate-music">
                {soundBusy === 'music' ? <Loader2 size={13} className="rc-spin" /> : <Music size={13} />}
                {musicTrack ? 'Regenerate' : 'Generate music'}
              </button>
            </div>
            <textarea value={musicPrompt} onChange={(e) => setMusicPrompt(e.currentTarget.value)} rows={2} disabled={!musicOn} placeholder="Describe the music — genre, mood, tempo, instruments." className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical', opacity: musicOn ? 1 : 0.55 }} data-testid="input-music-prompt" />
            {musicTrack ? (
              <div style={{ marginTop: 9 }}>
                <audio src={musicTrack.url} controls style={{ width: '100%', height: 34 }} data-testid="audio-music" />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: S.muted }}>{musicTrack.note}</p>
              </div>
            ) : null}
          </div>

          {/* OPTIONAL sound effects */}
          <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, marginBottom: 10 }} data-testid="card-sound-sfx">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 700 }}>
                Sound effects
                <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: S.panelStrong, color: S.muted }}>OPTIONAL</span>
              </span>
              <button type="button" onClick={() => void makeSfx()} disabled={!sfxPrompt.trim() || soundBusy !== ''} className="ps-btn" style={{ ...ghostBtn, opacity: !sfxPrompt.trim() || soundBusy !== '' ? 0.55 : 1 }} data-testid="button-generate-sfx">
                {soundBusy === 'sfx' ? <Loader2 size={13} className="rc-spin" /> : <Sparkles size={13} />}
                {sfxTrack ? 'Regenerate' : 'Generate effects'}
              </button>
            </div>
            <textarea value={sfxPrompt} onChange={(e) => { setSfxPrompt(e.currentTarget.value); setSfxTrack(null); }} rows={2} placeholder="Leave empty to skip. Or describe the effects you want, e.g. whooshes on the cuts and a deep impact on the reveal." className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }} data-testid="input-sfx-prompt" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
              <span style={{ fontSize: 11, color: S.muted }}>Nothing to add? Leave it blank — this is entirely optional.</span>
              <button type="button" onClick={() => { setSfxPrompt(style.sfxSuggestion); setSfxTrack(null); }} className="ps-btn" style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11 }} data-testid="button-sfx-suggestion">
                Use the {style.name} suggestion
              </button>
            </div>
            {sfxTrack ? (
              <div style={{ marginTop: 9 }}>
                <audio src={sfxTrack.url} controls style={{ width: '100%', height: 34 }} data-testid="audio-sfx" />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: S.muted }}>{sfxTrack.note}</p>
              </div>
            ) : null}
          </div>

          {/* OPTIONAL captions */}
          <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13 }} data-testid="card-sound-captions">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Toggle on={captionsOn} onChange={setCaptionsOn} label="Add captions" />
              <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 700 }}>
                Add captions
                <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: S.panelStrong, color: S.muted }}>OPTIONAL</span>
              </span>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
              Burns captions into the film and gives you a .SRT caption file to download alongside it. Timed exactly to the shots, not transcribed.
            </p>
          </div>

          {soundNote ? (
            <p role="status" style={{ margin: '12px 0 0', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: S.brand }} data-testid="note-sound">
              <Loader2 size={12} className="rc-spin" /> {soundNote}
            </p>
          ) : null}
          {byokVerdictNote() ? (
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }} data-testid="note-byok">{byokVerdictNote()}</p>
          ) : null}
          <ErrorBanner message={soundError} />
        </section>
      ) : null}

      {/* ---------------- Phase 7 — Generate ---------------- */}
      {phase === 7 ? (
        <section style={panelStyle} data-testid="panel-wizard-generate">
          <span style={labelStyle}><Clapperboard size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Ready to render</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', margin: '12px 0 14px' }}>
            {[
              { label: 'Style', value: style.name },
              { label: 'Shots', value: `${beats.length} × ${style.clipSeconds}s` },
              { label: 'Runtime', value: `≈ ${Math.round(filmSeconds)}s` },
              { label: 'Narration', value: narrationOn && narrationUrl ? 'ready' : narrationOn ? 'not recorded' : 'off' },
              { label: 'Music', value: musicOn && musicTrack ? 'ready' : musicOn ? 'not generated' : 'off' },
              { label: 'Sound effects', value: sfxTrack ? 'ready' : 'none' },
              { label: 'Captions', value: captionsOn ? 'on' : 'off' },
            ].map((c) => (
              <span key={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: `1px solid ${S.border}`, background: S.panelStrong, fontSize: 12, fontWeight: 700, color: S.sub }}>
                <span style={{ color: S.muted, fontWeight: 600 }}>{c.label}:</span> {c.value}
              </span>
            ))}
          </div>

          <button type="button" onClick={() => void startGeneration()} disabled={starting || !beats.length} className="ps-btn" style={{ ...primaryBtn, padding: '12px 22px', fontSize: 14, opacity: starting || !beats.length ? 0.6 : 1 }} data-testid="button-wizard-generate">
            {starting ? <Loader2 size={15} className="rc-spin" /> : <Sparkles size={15} />}
            {starting ? 'Starting the render…' : 'Generate video'}
          </button>
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
            The render runs on our servers and every clip is saved the moment it finishes — once it starts you can close this tab and come back any time. The finished video is added to Saved Videos automatically.
          </p>
          <ErrorBanner message={genError} />
        </section>
      ) : null}

      {/* ---------------- Footer nav ---------------- */}
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingBottom: 24 }}>
        <button type="button" onClick={goBack} disabled={phase === 1} className="ps-btn" style={{ ...ghostBtn, opacity: phase === 1 ? 0.5 : 1 }} data-testid="button-wizard-back">
          <ArrowLeft size={13} /> Back
        </button>
        {phase < TOTAL_PHASES && phase !== 4 ? (
          <button type="button" onClick={goNext} disabled={!canContinue} className="ps-btn" style={{ ...primaryBtn, opacity: canContinue ? 1 : 0.5 }} data-testid="button-wizard-continue">
            {phase === 1 ? 'Use this style' : phase === 2 ? 'Confirm' : phase === 6 ? 'Review & render' : 'Continue'} <ArrowRight size={14} />
          </button>
        ) : null}
        {phase === 4 && scriptApproved ? (
          <button type="button" onClick={goNext} className="ps-btn" style={primaryBtn} data-testid="button-wizard-continue">
            Continue <ArrowRight size={14} />
          </button>
        ) : null}
      </footer>
    </div>
  );
}
