/**
 * Clip Style — the phased Product Video creation pipeline for the hand-cut
 * paper collage animation style. Selected from the "Choose Style" step of the
 * Create-new-video flow (see MyVideos.tsx); rendered full-screen by App.tsx.
 *
 * Six gated phases — each must be completed before the next appears:
 *   1. Product Input   (URL via the scrape-website hook, or a typed description)
 *   2. Video Duration  (30s / 1m / 2m / custom word target)
 *   3. Script          (gpt-5.6-terra narration, documentary TTS punctuation rules)
 *   4. Beat Breakdown  (~10-word beats, timecode = running words ÷ 2.5)
 *   5. Image Prompts   (one [B00N] line per beat; global STYLE LOCK applied once)
 *   6. Animation + Generate (fixed universal animation prompt shown for
 *      reference; hands the whole render to the clipstyle-run SERVER
 *      function — collage frame generation, 4s Remotion clip renders and
 *      the final stitch all run server-side, and every URL is persisted to
 *      clipstyle_projects / clipstyle_clips the moment it exists, so the
 *      run and its results survive tab close. The browser only starts the
 *      job and polls a status card; reopening the wizard resumes an
 *      in-flight run.)
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  Clock,
  Download,
  FileText,
  Globe,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Scissors,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { trackB, getWorkspaceToken, resolveSessionId, type ScrapedProductBrief } from '../../lib/trackB/api';
import {
  CLIP_STYLE_NAME,
  CLIP_STYLE_LOCK,
  CLIP_STYLE_NEGATIVE,
  CLIP_STYLE_ANIMATION_PROMPT,
  CLIP_STYLE_REMOTION_COMPOSITION,
  DURATION_OPTIONS,
  SCRIPT_RULES,
  SECONDS_PER_CLIP,
  TOTAL_PHASES,
  WORDS_PER_SECOND,
  type ClipBeat,
  beatCode,
  buildBeatImagePrompt,
  chunkScriptIntoBeatTexts,
  countWords,
  formatTimecode,
  sanitizeNarration,
  segmentsMatchScript,
  toClipBeats,
  wordsForSeconds,
} from './clipStyleTemplate';

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

const TEXT_MODEL = 'gpt-5.6-terra';
/** The server-side Clip Style pipeline — the clipstyle-run server function. */
const CLIPSTYLE_RUN_ENDPOINT = '/api/hooks/execute/workspace-660069/clipstyle-run';

const PHASE_TITLES = ['Product Input', 'Video Duration', 'Script', 'Beat Breakdown', 'Image Prompts', 'Animate & Generate'];

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

// ---------------------------------------------------------------------------
// AI + render plumbing
// ---------------------------------------------------------------------------

async function aiChat(messages: { role: 'system' | 'user'; content: string }[], maxTokens = 4096): Promise<string> {
  const token = getWorkspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ model: TEXT_MODEL, reasoning_effort: 'none', messages, max_completion_tokens: maxTokens, stream: false }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(String(data?.error?.message || data?.error || `AI request failed (HTTP ${res.status}).`));
  if (data?.error) throw new Error(String(data.error.message || 'AI request failed.'));
  return String(data?.choices?.[0]?.message?.content || '');
}

function extractJson(raw: string, open: string, close: string): string {
  const start = raw.indexOf(open);
  const end = raw.lastIndexOf(close);
  if (start < 0 || end <= start) throw new Error('The AI reply came back in an unexpected format — try again.');
  return raw.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Server pipeline plumbing — the heavy work (collage frame generation, clip
// renders, polling, the final stitch) runs in the clipstyle-run server
// function and is persisted to clipstyle_projects / clipstyle_clips as it
// happens, so it survives tab close. The browser only starts the job and
// polls status.
// ---------------------------------------------------------------------------

interface ServerProject {
  id: number;
  status: 'in_progress' | 'rendered' | 'failed';
  product_name: string | null;
  total_beats: number;
  final_video_url: string | null;
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
  if (token) headers['X-Workspace-DB-Token'] = token;
  const res = await fetch(CLIPSTYLE_RUN_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, session_id: resolveSessionId() }),
  });
  const raw = await res.json().catch(() => null);
  // Hook responses may sit at the top level or under `response`.
  const data = raw && typeof raw === 'object' && ('success' in raw || 'error' in raw) ? raw : (raw?.response ?? raw);
  if (!res.ok || !data || data.success === false || data.error) {
    throw new Error(String(data?.error || `The render service could not be reached (HTTP ${res.status}).`));
  }
  return data as T;
}

export default function ClipStyleWizard({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState(1);

  // Phase 1 — product input
  const [inputMode, setInputMode] = useState<'url' | 'manual'>('url');
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [brief, setBrief] = useState<ScrapedProductBrief | null>(null);
  const [manualDesc, setManualDesc] = useState('');
  const [productError, setProductError] = useState<string | null>(null);

  // Phase 2 — duration
  const [durationId, setDurationId] = useState<string>('30s');
  const [customSeconds, setCustomSeconds] = useState('45');

  // Phase 3 — script
  const [script, setScript] = useState('');
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  // Phase 4 — beats
  const [beats, setBeats] = useState<ClipBeat[]>([]);
  const [beatsBusy, setBeatsBusy] = useState(false);
  const [beatsError, setBeatsError] = useState<string | null>(null);

  // Phase 5 — image prompts
  const [prompts, setPrompts] = useState<string[]>([]);
  const [promptsBusy, setPromptsBusy] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [styleLockOpen, setStyleLockOpen] = useState(false);

  // Phase 6 — generation (server-driven). `project`/`clips` mirror the
  // clipstyle-run rows; while a project is active the wizard shows the
  // status card instead of the phases.
  const [project, setProject] = useState<ServerProject | null>(null);
  const [clips, setClips] = useState<ServerClip[]>([]);
  const [starting, setStarting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState<number | null>(null); // beat_index, or -1 for the join
  const [lastReady, setLastReady] = useState<ServerProject | null>(null);
  const [lastReadyDismissed, setLastReadyDismissed] = useState(false);

  const targetSeconds = durationId === 'custom'
    ? Math.min(600, Math.max(10, Math.round(Number(customSeconds) || 0)))
    : (DURATION_OPTIONS.find((d) => d.id === durationId)?.seconds ?? 30);
  const targetWords = durationId === 'custom'
    ? wordsForSeconds(targetSeconds)
    : (DURATION_OPTIONS.find((d) => d.id === durationId)?.words ?? 75);

  const productContext = useCallback((): string => {
    if (brief) {
      const parts: string[] = [];
      if (brief.product_name) parts.push('Product: ' + brief.product_name);
      if (brief.tagline) parts.push('Tagline: ' + brief.tagline);
      if (Array.isArray(brief.key_features) && brief.key_features.length) parts.push('Key features: ' + brief.key_features.slice(0, 6).join('; '));
      if (Array.isArray(brief.pain_points_addressed) && brief.pain_points_addressed.length) parts.push('Problems it solves: ' + brief.pain_points_addressed.slice(0, 4).join('; '));
      if (Array.isArray(brief.unique_differentiators) && brief.unique_differentiators.length) parts.push('Differentiators: ' + brief.unique_differentiators.slice(0, 3).join('; '));
      if (brief.tone) parts.push('Tone: ' + brief.tone);
      if (parts.length) return parts.join('\n');
    }
    return manualDesc.trim();
  }, [brief, manualDesc]);

  const productName = brief?.product_name || manualDesc.trim().split(/\s+/).slice(0, 4).join(' ') || 'this product';

  // -------------------------------------------------------------------------
  // Phase 1 — product intake
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

  const productReady = inputMode === 'url' ? !!brief : countWords(manualDesc) >= 5;

  // -------------------------------------------------------------------------
  // Phase 3 — script generation
  // -------------------------------------------------------------------------
  const generateScript = useCallback(async () => {
    setScriptError(null);
    setScriptBusy(true);
    try {
      const raw = await aiChat([
        {
          role: 'system',
          content:
            'You write narration scripts for premium documentary style product videos. Follow every rule exactly:\n- ' +
            SCRIPT_RULES.join('\n- ') +
            '\nRespond with ONLY the narration text. No headings, no word counts, no notes.',
        },
        {
          role: 'user',
          content:
            'Write the product narration script.\n\nPRODUCT:\n' + productContext().slice(0, 4000) +
            '\n\nTARGET LENGTH: about ' + targetWords + ' words (within five percent), which is roughly ' + targetSeconds + ' seconds spoken at two and a half words per second.',
        },
      ], 4096);
      const cleaned = sanitizeNarration(raw);
      if (countWords(cleaned) < 10) throw new Error('The script came back too short — try again.');
      setScript(cleaned);
      setBeats([]);
      setPrompts([]);
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'The script could not be generated — try again.');
    } finally {
      setScriptBusy(false);
    }
  }, [productContext, targetWords, targetSeconds]);

  // Auto-generate the script the first time Phase 3 opens.
  useEffect(() => {
    if (phase === 3 && !script && !scriptBusy && !scriptError) void generateScript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -------------------------------------------------------------------------
  // Phase 4 — beat breakdown
  // -------------------------------------------------------------------------
  const buildBeats = useCallback(async () => {
    setBeatsError(null);
    setBeatsBusy(true);
    const clean = sanitizeNarration(script);
    try {
      let texts: string[] | null = null;
      try {
        const raw = await aiChat([
          {
            role: 'user',
            content:
              'Cut this narration into visual beats of about ten words each (nine to eleven words). Keep the words VERBATIM, in order, with nothing dropped, added or changed — prefer cutting at natural phrase boundaries. Respond with ONLY a JSON array of strings, one string per beat.\n\nNARRATION:\n' + clean,
          },
        ], 8000);
        const parsed = JSON.parse(extractJson(raw, '[', ']'));
        if (Array.isArray(parsed) && parsed.length && parsed.every((s: unknown) => typeof s === 'string')) {
          const candidate = (parsed as string[]).map((s) => s.trim()).filter(Boolean);
          if (segmentsMatchScript(clean, candidate)) texts = candidate;
        }
      } catch {
        /* deterministic fallback below */
      }
      if (!texts) texts = chunkScriptIntoBeatTexts(clean);
      if (!texts.length) throw new Error('The script has no words to cut into beats.');
      setScript(clean);
      setBeats(toClipBeats(texts));
      setPrompts([]);
    } catch (e) {
      setBeatsError(e instanceof Error ? e.message : 'The beat breakdown failed — try again.');
    } finally {
      setBeatsBusy(false);
    }
  }, [script]);

  useEffect(() => {
    if (phase === 4 && !beats.length && !beatsBusy && !beatsError) void buildBeats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -------------------------------------------------------------------------
  // Phase 5 — image prompts
  // -------------------------------------------------------------------------
  const generatePrompts = useCallback(async () => {
    setPromptsError(null);
    setPromptsBusy(true);
    try {
      const beatLines = beats.map((b) => b.code + ' | ' + b.text).join('\n');
      const raw = await aiChat([
        {
          role: 'system',
          content:
            'You write image generation prompt lines for a hand cut documentary paper collage product video. A global STYLE LOCK already covers the collage aesthetic (aged newsprint, halftone cutouts, tape, stamps, red thread, palette, lighting, 16:9) — NEVER repeat any of it in your lines.\nRules for every line:\n' +
            '- 25 to 40 words, tight and concrete, a single line with no line breaks inside it.\n' +
            '- Order: the dominant hero element first, then up to three supporting elements, then one background or empty-space note.\n' +
            '- Hero options: the product device, app or interface, a faceless figure, a phone, a laptop, an analytics dashboard, money or credits, a document, a screenshot, a social post, a newspaper clipping, a map, a timeline, a website interface.\n' +
            '- If the beat carries a key date, name, amount or stat, write it as a one to four word label on a paper strip, rubber stamp or torn headline, and give the exact label wording in the line.\n' +
            '- NO recognisable human faces anywhere. If a person is needed: seen from behind, over the shoulder, cropped below the eyes, a silhouette, or hands only.\n' +
            '- Recurring subjects (the product, a figure, an app screen) must be described with IDENTICAL wording every time they appear so the clips stay visually consistent.',
        },
        {
          role: 'user',
          content:
            'PRODUCT:\n' + productContext().slice(0, 2500) +
            '\n\nBEATS (code | narration):\n' + beatLines +
            '\n\nWrite exactly one prompt line per beat. Respond with ONLY a JSON array of objects, in beat order, exactly this shape: [{ "code": "B001", "prompt": "..." }]',
        },
      ], 8000);
      const parsed = JSON.parse(extractJson(raw, '[', ']'));
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('The AI returned no prompt lines — try again.');
      const byCode = new Map<string, string>();
      for (const item of parsed) {
        if (item && typeof item.code === 'string' && typeof item.prompt === 'string') {
          byCode.set(item.code.trim().toUpperCase(), item.prompt.replace(/\s+/g, ' ').trim());
        }
      }
      const lines = beats.map((b, i) => byCode.get(b.code) || byCode.get(beatCode(i)) || '');
      const missing = lines.reduce((n, l) => n + (l ? 0 : 1), 0);
      if (missing > 0) throw new Error(missing + ' beat prompt' + (missing === 1 ? '' : 's') + ' came back empty — regenerate.');
      setPrompts(lines);
    } catch (e) {
      setPromptsError(e instanceof Error ? e.message : 'The image prompts could not be generated — try again.');
    } finally {
      setPromptsBusy(false);
    }
  }, [beats, productContext]);

  useEffect(() => {
    if (phase === 5 && !prompts.length && !promptsBusy && !promptsError && beats.length) void generatePrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -------------------------------------------------------------------------
  // Phase 6 — server-driven generation
  // -------------------------------------------------------------------------

  // Catch-up on mount: an in-flight (or recently failed) run is adopted so a
  // customer who closed the tab mid-render lands straight on the status card;
  // a recently finished one is offered as a banner on Phase 1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await clipStyleRun<{ projects: ServerProject[] }>({ op: 'list' });
        if (cancelled) return;
        const rows = res.projects || [];
        const newest = rows[0];
        const live = rows.find((p) => p.status === 'in_progress');
        const dayMs = 24 * 60 * 60 * 1000;
        const isRecent = (p: ServerProject) => Date.now() - new Date(p.updated_at || p.created_at || 0).getTime() < dayMs;
        const adopt = live || (newest && newest.status === 'failed' && isRecent(newest) ? newest : null);
        if (adopt) {
          const st = await clipStyleRun<StatusPayload>({ op: 'status', project_id: adopt.id });
          if (cancelled) return;
          setProject(st.project);
          setClips(st.clips || []);
        } else if (newest && newest.status === 'rendered' && isRecent(newest)) {
          setLastReady(newest);
        }
      } catch {
        /* no session yet or nothing to resume — the wizard starts fresh */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll the run while it is in progress. The server-side chain does the
  // real work; this only refreshes the card (and revives an orphaned chain
  // when the customer comes back).
  useEffect(() => {
    if (!project || project.status !== 'in_progress') return;
    let stopped = false;
    const poll = async () => {
      try {
        const st = await clipStyleRun<StatusPayload>({ op: 'status', project_id: project.id });
        if (stopped) return;
        setProject(st.project);
        setClips(st.clips || []);
      } catch { /* next interval retries */ }
    };
    const timer = window.setInterval(() => { void poll(); }, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.status]);

  const startGeneration = useCallback(async () => {
    setGenError(null);
    setStarting(true);
    try {
      const res = await clipStyleRun<StatusPayload>({
        op: 'start',
        project_key: 'cs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        product_name: productName,
        script,
        beats: beats.map((b) => ({ code: b.code, text: b.text })),
        prompts: prompts.map((p) => buildBeatImagePrompt(p)),
        composition_tsx: CLIP_STYLE_REMOTION_COMPOSITION,
      });
      setProject(res.project);
      setClips(res.clips || []);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'The render could not be started — try again.');
    } finally {
      setStarting(false);
    }
  }, [beats, prompts, script, productName]);

  const retryClip = useCallback(async (beatIndex: number) => {
    if (!project) return;
    setGenError(null);
    setRetryBusy(beatIndex);
    try {
      const res = await clipStyleRun<StatusPayload>({ op: 'retry_clip', project_id: project.id, beat_index: beatIndex });
      setProject(res.project);
      setClips(res.clips || []);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'The retry could not be started.');
    } finally {
      setRetryBusy(null);
    }
  }, [project]);

  const retryStitch = useCallback(async () => {
    if (!project) return;
    setGenError(null);
    setRetryBusy(-1);
    try {
      const res = await clipStyleRun<StatusPayload>({ op: 'restitch', project_id: project.id });
      setProject(res.project);
      setClips(res.clips || []);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'The join retry could not be started.');
    } finally {
      setRetryBusy(null);
    }
  }, [project]);

  const startNewVideo = useCallback(() => {
    setProject(null);
    setClips([]);
    setGenError(null);
    setLastReady(null);
    setLastReadyDismissed(true);
    setPhase(1);
  }, []);

  // -------------------------------------------------------------------------
  // Phase gating
  // -------------------------------------------------------------------------
  const canContinue =
    phase === 1 ? productReady :
    phase === 2 ? targetWords > 0 :
    phase === 3 ? countWords(script) >= 10 && !scriptBusy :
    phase === 4 ? beats.length > 0 && !beatsBusy :
    phase === 5 ? prompts.length === beats.length && prompts.every((p) => countWords(p) >= 5) && !promptsBusy :
    false;

  const goNext = () => {
    if (phase === 3) {
      const clean = sanitizeNarration(script);
      setScript(clean);
      setBeats([]);
      setPrompts([]);
    }
    setPhase((p) => Math.min(TOTAL_PHASES, p + 1));
  };
  const goBack = () => setPhase((p) => Math.max(1, p - 1));

  // -------------------------------------------------------------------------
  // Render — the status card (an active run) or the phased wizard
  // -------------------------------------------------------------------------
  if (project) {
    const doneClips = clips.filter((c) => c.status === 'done');
    const failedClips = clips.filter((c) => c.status === 'failed');
    const allClipsDone = clips.length > 0 && doneClips.length === clips.length;
    const stitchFailed = project.status === 'failed' && allClipsDone;
    const chip =
      project.status === 'rendered' ? { label: 'Ready', color: S.success } :
      project.status === 'failed' ? { label: 'Needs attention', color: S.danger } :
      { label: `Rendering ${doneClips.length} / ${clips.length || project.total_beats}`, color: S.brand };
    return (
      <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(14px, 3vw, 28px)', color: S.text, boxSizing: 'border-box' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" onClick={onExit} className="ps-btn" style={ghostBtn} data-testid="button-clipstyle-status-exit">
            <ArrowLeft size={13} /> My Videos
          </button>
          <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 'clamp(17px, 2.6vw, 22px)', fontWeight: 800 }}>
            <Scissors size={19} color="var(--space-text-brand)" /> {CLIP_STYLE_NAME}
          </h1>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, border: `1px solid color-mix(in srgb, ${chip.color} 40%, transparent)`, background: `color-mix(in srgb, ${chip.color} 12%, transparent)`, fontSize: 12, fontWeight: 800, color: chip.color }} data-testid="chip-clipstyle-status">
            {project.status === 'in_progress' ? <Loader2 size={12} className="rc-spin" /> : project.status === 'rendered' ? <Check size={12} /> : <X size={12} />}
            {chip.label}
          </span>
        </header>

        <section style={panelStyle} data-testid="panel-clipstyle-progress">
          <span style={labelStyle}><Clapperboard size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />{project.product_name || 'Your Clip Style video'}</span>

          {project.status === 'in_progress' ? (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: S.brand }} data-testid="status-clipstyle-running">
              <Loader2 size={14} className="rc-spin" /> Rendering {doneClips.length} of {clips.length || project.total_beats} clips on our servers — you can close this tab and come back any time. Every clip is saved the moment it finishes.
            </p>
          ) : null}

          {project.status === 'rendered' && project.final_video_url ? (
            <div className="ps-fade-up" style={{ marginBottom: 14 }} data-testid="panel-clipstyle-final">
              <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', fontSize: 13.5, fontWeight: 800, color: S.success }}>
                <Check size={15} /> Your Clip Style video is ready.
              </p>
              <video src={project.final_video_url} controls playsInline style={{ display: 'block', width: '100%', maxWidth: 640, borderRadius: 14, border: `1px solid ${S.borderStrong}`, background: '#000' }} data-testid="video-clipstyle-final" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <a href={project.final_video_url} download target="_blank" rel="noreferrer" className="ps-btn" style={primaryBtn} data-testid="link-clipstyle-download">
                  <Download size={14} /> Download video
                </a>
                <button type="button" onClick={startNewVideo} className="ps-btn" style={ghostBtn} data-testid="button-clipstyle-new">
                  <Sparkles size={13} /> Start a new Clip Style video
                </button>
              </div>
            </div>
          ) : null}

          {project.status === 'failed' ? (
            <div style={{ marginBottom: 14 }} data-testid="panel-clipstyle-failed">
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: S.danger, lineHeight: 1.6 }}>{project.error || 'The render needs attention.'}</p>
              {stitchFailed ? (
                <button type="button" onClick={() => void retryStitch()} disabled={retryBusy !== null} className="ps-btn" style={{ ...ghostBtn, opacity: retryBusy !== null ? 0.6 : 1 }} data-testid="button-restitch">
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
                c.image_url ? 'frame ready — waiting to animate' : 'cutting the collage frame…';
              return (
                <div key={c.beat_code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 11, border: `1px solid ${c.status === 'failed' ? `color-mix(in srgb, ${S.danger} 40%, transparent)` : S.border}`, background: S.card, flexWrap: 'wrap' }} data-testid={`gen-row-${c.beat_code}`}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: S.brand, width: 42 }}>{c.beat_code}</span>
                  {c.image_url ? <img src={c.image_url} alt={`${c.beat_code} collage frame`} style={{ width: 52, height: 30, objectFit: 'cover', borderRadius: 6, border: `1px solid ${S.border}` }} /> : <span style={{ width: 52, height: 30, borderRadius: 6, background: S.panelStrong, display: 'inline-block' }} />}
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
                    <button type="button" onClick={() => void retryClip(c.beat_index)} disabled={retryBusy !== null} className="ps-btn" style={{ ...ghostBtn, padding: '5px 10px', fontSize: 11.5, opacity: retryBusy !== null ? 0.6 : 1 }} data-testid={`button-retry-${c.beat_code}`}>
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

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(14px, 3vw, 28px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" onClick={onExit} className="ps-btn" style={ghostBtn} data-testid="button-clipstyle-exit">
          <ArrowLeft size={13} /> My Videos
        </button>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 'clamp(17px, 2.6vw, 22px)', fontWeight: 800 }}>
          <Scissors size={19} color="var(--space-text-brand)" /> {CLIP_STYLE_NAME}
        </h1>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, border: `1px solid ${S.border}`, background: S.panelStrong, fontSize: 12, fontWeight: 800, color: S.brand }} data-testid="chip-clipstyle-phase">
          Phase {phase} of {TOTAL_PHASES}
        </span>
      </header>

      {/* Phase indicator rail */}
      <div className="ps-scroll-x" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }} aria-label="Pipeline phases">
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

      {phase === 1 && lastReady && !lastReadyDismissed ? (
        <div className="ps-fade-up" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderRadius: 14, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: '12px 14px', marginBottom: 16 }} data-testid="banner-clipstyle-last">
          <Check size={15} color={S.success} />
          <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: S.sub }}>
            Your last Clip Style video{lastReady.product_name ? ` for ${lastReady.product_name}` : ''} is ready.
          </span>
          {lastReady.final_video_url ? (
            <a href={lastReady.final_video_url} target="_blank" rel="noreferrer" className="ps-btn" style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }} data-testid="link-clipstyle-last">
              <Download size={12} /> Watch / download
            </a>
          ) : null}
          <button type="button" onClick={() => setLastReadyDismissed(true)} aria-label="Dismiss" className="ps-btn" style={{ ...ghostBtn, padding: '6px 9px' }} data-testid="button-clipstyle-last-dismiss">
            <X size={12} />
          </button>
        </div>
      ) : null}

      {/* ---------------- Phase 1 — Product Input ---------------- */}
      {phase === 1 ? (
        <section style={panelStyle} data-testid="panel-clipstyle-product">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Your product</span>
            <div role="radiogroup" aria-label="Product input mode" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: `1px solid ${S.border}`, background: S.panelStrong }}>
              {(['url', 'manual'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={inputMode === m} onClick={() => setInputMode(m)} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, border: 'none', background: inputMode === m ? 'var(--space-brand-primary-600)' : 'transparent', color: inputMode === m ? 'var(--space-text-on-primary)' : S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }} data-testid={`tab-clipstyle-${m}`}>
                  {m === 'url' ? <Globe size={13} /> : <Pencil size={13} />} {m === 'url' ? 'Paste a URL' : 'Describe it'}
                </button>
              ))}
            </div>
          </div>

          {inputMode === 'url' ? (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={url} onChange={(e) => { setUrl(e.currentTarget.value); setBrief(null); }} placeholder="https://yourproduct.com" className="ps-input" style={{ ...inputStyle, flex: '1 1 260px' }} data-testid="input-clipstyle-url" />
                <button type="button" onClick={() => void fetchProduct()} disabled={scraping} className="ps-btn" style={{ ...primaryBtn, opacity: scraping ? 0.6 : 1 }} data-testid="button-clipstyle-fetch">
                  {scraping ? <Loader2 size={14} className="rc-spin" /> : <Sparkles size={14} />}
                  {scraping ? 'Reading the page…' : 'Fetch product details'}
                </button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted }}>The page is read once to pull the product name, tagline and features.</p>
            </div>
          ) : (
            <textarea value={manualDesc} onChange={(e) => setManualDesc(e.currentTarget.value)} rows={5} maxLength={2000} placeholder="What is the product, who is it for, and what does it do? A few sentences is plenty." className="ps-input" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }} data-testid="input-clipstyle-manual" />
          )}

          {productReady ? (
            <div className="ps-fade-up" style={{ marginTop: 14, borderRadius: 12, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 14 }} data-testid="card-clipstyle-summary">
              <span style={{ ...labelStyle, marginBottom: 8 }}>Confirm your product</span>
              {brief ? (
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

      {/* ---------------- Phase 2 — Duration ---------------- */}
      {phase === 2 ? (
        <section style={panelStyle} data-testid="panel-clipstyle-duration">
          <span style={labelStyle}>How long should the video run?</span>
          <div role="radiogroup" aria-label="Video duration" style={{ display: 'grid', gap: 8 }}>
            {DURATION_OPTIONS.map((opt, i) => {
              const active = durationId === opt.id;
              return (
                <button key={opt.id} type="button" role="radio" aria-checked={active} onClick={() => setDurationId(opt.id)} className="ps-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, textAlign: 'left', border: `1px solid ${active ? 'var(--space-brand-primary-600)' : S.border}`, background: active ? 'color-mix(in srgb, var(--space-brand-primary-600) 14%, transparent)' : S.card, color: S.text, cursor: 'pointer' }} data-testid={`option-duration-${opt.id}`}>
                  <span style={{ flex: 'none', width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, fontSize: 12, fontWeight: 800, background: active ? 'var(--space-brand-primary-600)' : S.panelStrong, color: active ? 'var(--space-text-on-primary)' : S.muted }}>{i + 1}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{opt.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: S.muted }}>
                    {opt.words != null ? `approx ${opt.words} words narration` : 'type your own target'}
                  </span>
                </button>
              );
            })}
          </div>
          {durationId === 'custom' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <label htmlFor="clipstyle-custom-seconds" style={{ ...labelStyle, marginBottom: 0 }}>Target length (seconds)</label>
              <input id="clipstyle-custom-seconds" value={customSeconds} onChange={(e) => setCustomSeconds(e.currentTarget.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="ps-input" style={{ ...inputStyle, width: 110 }} data-testid="input-duration-custom" />
              <span style={{ fontSize: 12, color: S.muted }}>≈ {targetWords} words narration</span>
            </div>
          ) : null}
          <p style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '14px 0 0', fontSize: 12, color: S.muted }}>
            <Clock size={13} /> Every Clip Style clip is {SECONDS_PER_CLIP} seconds — about {Math.max(1, Math.ceil(targetWords / 10))} clips at this length.
          </p>
        </section>
      ) : null}

      {/* ---------------- Phase 3 — Script ---------------- */}
      {phase === 3 ? (
        <section style={panelStyle} data-testid="panel-clipstyle-script">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}><FileText size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Narration script</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: S.muted }} data-testid="chip-script-words">{countWords(script)} / ~{targetWords} words</span>
              <button type="button" onClick={() => void generateScript()} disabled={scriptBusy} className="ps-btn" style={{ ...ghostBtn, opacity: scriptBusy ? 0.6 : 1 }} data-testid="button-script-regenerate">
                {scriptBusy ? <Loader2 size={13} className="rc-spin" /> : <RefreshCw size={13} />}
                {scriptBusy ? 'Writing…' : script ? 'Regenerate' : 'Generate script'}
              </button>
            </div>
          </div>
          {scriptBusy && !script ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: '18px 0' }}>
              <Loader2 size={14} className="rc-spin" /> Writing a documentary narration for {productName}…
            </div>
          ) : (
            <textarea value={script} onChange={(e) => setScript(e.currentTarget.value)} rows={9} className="ps-input" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} placeholder="The narration appears here — edit it freely before continuing." data-testid="input-clipstyle-script" />
          )}
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
            Documentary delivery. Only full stops and question marks — numbers written as spoken words. Your edits are kept; punctuation is re-checked when you continue.
          </p>
          <ErrorBanner message={scriptError} />
        </section>
      ) : null}

      {/* ---------------- Phase 4 — Beat Breakdown ---------------- */}
      {phase === 4 ? (
        <section style={panelStyle} data-testid="panel-clipstyle-beats">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}><Layers size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Visual beats · ~10 words ≈ {SECONDS_PER_CLIP}s each</span>
            <button type="button" onClick={() => void buildBeats()} disabled={beatsBusy} className="ps-btn" style={{ ...ghostBtn, opacity: beatsBusy ? 0.6 : 1 }} data-testid="button-beats-rebuild">
              {beatsBusy ? <Loader2 size={13} className="rc-spin" /> : <RefreshCw size={13} />}
              {beatsBusy ? 'Cutting…' : 'Re-cut beats'}
            </button>
          </div>
          {beatsBusy && !beats.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: '18px 0' }}>
              <Loader2 size={14} className="rc-spin" /> Cutting the narration into beats…
            </div>
          ) : beats.length ? (
            <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${S.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 460 }} data-testid="table-clipstyle-beats">
                <thead>
                  <tr style={{ background: S.panelStrong }}>
                    {['Beat Code', 'Timecode Start', 'Narration Text'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: S.muted, borderBottom: `1px solid ${S.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {beats.map((b) => (
                    <tr key={b.code} style={{ borderBottom: `1px solid ${S.border}` }} data-testid={`beat-row-${b.code}`}>
                      <td style={{ padding: '8px 12px', fontWeight: 800, color: S.brand, whiteSpace: 'nowrap' }}>{b.code}</td>
                      <td style={{ padding: '8px 12px', color: S.sub, whiteSpace: 'nowrap' }}>{formatTimecode(b.startSec)}</td>
                      <td style={{ padding: '8px 12px', color: S.text, lineHeight: 1.5 }}>{b.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {beats.length ? (
            <p style={{ margin: '9px 0 0', fontSize: 11.5, color: S.muted }}>
              {beats.length} beats · every word of the script, in order, nothing dropped. Confirm to continue.
            </p>
          ) : null}
          <ErrorBanner message={beatsError} />
        </section>
      ) : null}

      {/* ---------------- Phase 5 — Image Prompts ---------------- */}
      {phase === 5 ? (
        <section style={panelStyle} data-testid="panel-clipstyle-prompts">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}><Wand2 size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />One image prompt per beat</span>
            <button type="button" onClick={() => void generatePrompts()} disabled={promptsBusy} className="ps-btn" style={{ ...ghostBtn, opacity: promptsBusy ? 0.6 : 1 }} data-testid="button-prompts-regenerate">
              {promptsBusy ? <Loader2 size={13} className="rc-spin" /> : <RefreshCw size={13} />}
              {promptsBusy ? 'Writing…' : 'Regenerate all'}
            </button>
          </div>

          <button type="button" onClick={() => setStyleLockOpen((v) => !v)} className="ps-btn" style={{ ...ghostBtn, width: '100%', justifyContent: 'space-between', marginBottom: 10 }} aria-expanded={styleLockOpen} data-testid="button-stylelock-toggle">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Scissors size={13} /> STYLE LOCK — applied to every image automatically</span>
            <ChevronDown size={14} style={{ transform: styleLockOpen ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }} />
          </button>
          {styleLockOpen ? (
            <div className="ps-fade-up" style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, marginBottom: 12, fontSize: 12, color: S.sub, lineHeight: 1.6, whiteSpace: 'pre-wrap' }} data-testid="panel-stylelock">
              {'STYLE LOCK\n' + CLIP_STYLE_LOCK + '\n\nNEGATIVE\n' + CLIP_STYLE_NEGATIVE}
            </div>
          ) : null}

          {promptsBusy && !prompts.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: '18px 0' }}>
              <Loader2 size={14} className="rc-spin" /> Writing {beats.length} collage prompts…
            </div>
          ) : prompts.length ? (
            <div style={{ display: 'grid', gap: 9 }}>
              {beats.map((b, i) => (
                <div key={b.code} style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: '10px 12px' }} data-testid={`prompt-row-${b.code}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: S.brand }}>[{b.code}]</span>
                    <span style={{ fontSize: 11, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 120 }}>{b.text}</span>
                    <span style={{ fontSize: 10.5, color: countWords(prompts[i]) < 25 || countWords(prompts[i]) > 40 ? '#fbbf24' : S.muted }}>{countWords(prompts[i])} words</span>
                  </div>
                  <textarea value={prompts[i]} onChange={(e) => setPrompts((cur) => cur.map((p, j) => (j === i ? e.currentTarget.value : p)))} rows={2} className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.55, resize: 'vertical' }} data-testid={`input-prompt-${b.code}`} />
                </div>
              ))}
            </div>
          ) : null}
          <ErrorBanner message={promptsError} />
        </section>
      ) : null}

      {/* ---------------- Phase 6 — Animation prompt + Generate ---------------- */}
      {phase === 6 ? (
        <section style={panelStyle} data-testid="panel-clipstyle-generate">
          <span style={labelStyle}><Clapperboard size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Universal animation prompt — the same for every clip</span>
          <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, fontSize: 12, color: S.sub, lineHeight: 1.6, whiteSpace: 'pre-wrap' }} data-testid="panel-animation-prompt">
            {CLIP_STYLE_ANIMATION_PROMPT}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
            {[
              { label: 'Total beats', value: String(beats.length) },
              { label: 'Clip length', value: SECONDS_PER_CLIP + 's each' },
              { label: 'Estimated video', value: formatTimecode(Math.round((countWords(script) / WORDS_PER_SECOND) * 10) / 10) },
              { label: 'Format', value: '16:9' },
            ].map((c) => (
              <span key={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999, border: `1px solid ${S.border}`, background: S.panelStrong, fontSize: 12, fontWeight: 700, color: S.sub }}>
                <span style={{ color: S.muted, fontWeight: 600 }}>{c.label}:</span> {c.value}
              </span>
            ))}
          </div>

          <button type="button" onClick={() => void startGeneration()} disabled={starting} className="ps-btn" style={{ ...primaryBtn, padding: '12px 22px', fontSize: 14, opacity: starting ? 0.6 : 1 }} data-testid="button-clipstyle-generate">
            {starting ? <Loader2 size={15} className="rc-spin" /> : <Sparkles size={15} />}
            {starting ? 'Starting the render…' : 'Generate Video'}
          </button>
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
            The render runs on our servers and every clip is saved the moment it finishes — once it starts you can close this tab and come back any time.
          </p>
          <ErrorBanner message={genError} />
        </section>
      ) : null}

      {/* ---------------- Footer nav ---------------- */}
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingBottom: 24 }}>
        <button type="button" onClick={goBack} disabled={phase === 1} className="ps-btn" style={{ ...ghostBtn, opacity: phase === 1 ? 0.5 : 1 }} data-testid="button-clipstyle-back">
          <ArrowLeft size={13} /> Back
        </button>
        {phase < TOTAL_PHASES ? (
          <button type="button" onClick={goNext} disabled={!canContinue} className="ps-btn" style={{ ...primaryBtn, opacity: canContinue ? 1 : 0.5 }} data-testid="button-clipstyle-continue">
            {phase === 1 ? 'Confirm product' : phase === 4 ? 'Confirm beats' : 'Continue'} <ArrowRight size={14} />
          </button>
        ) : null}
      </footer>
    </div>
  );
}
