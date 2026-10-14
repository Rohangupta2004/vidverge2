/**
 * FACELESS — the customer surface.
 *
 * Three screens and no more: a brief, the pipeline running, and the film.
 * The middle screen is the one that matters. A Faceless run makes dozens of
 * editorial decisions and spends real money doing it, so the progress view
 * shows what the director actually decided — which tier each beat landed on
 * and which beats were downgraded for cost — rather than a spinner and a
 * percentage. Above that list sits a three-phase bar, because "which of the
 * twelve stages is this" is not the question someone waiting actually has.
 *
 * Every callback is checkpointed to WorkspaceDB. The running screen polls the
 * durable row so a second tab can follow the same run and a recent unfinished
 * run can be restored after navigation or reload.
 *
 * The delivery options — aspect ratio, voice, music, captions, duration — are
 * declared once in lib/facelessOptions.ts and travel with the run as
 * `input.settings`, so the pipeline, the renderer and this file never disagree
 * about what was asked for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import {
  AlertCircle, ArrowLeft, CheckCircle2, Clapperboard, Clock,
  Download, Layers, Mic, Monitor, Music, Pause, Play, Share2,
  Smartphone, Sparkles, TriangleAlert, Type, Wand2,
} from 'lucide-react';

import {
  type DepthBackground,
  type FacelessMode,
  type FilmRunState,
  type FilmSettings,
  type FinalFilm,
  type PipelineStageId,
  type StageState,
  type StageUpdate,
} from './types/editorial';
import { createFacelessFilm, newFilmId } from './hooks/createFacelessFilm';
import VergeLoader from '../../components/VergeLoader';
import VideoErrorCard from '../../components/video/VideoErrorCard';
import VideoGeneratingState from '../../components/video/VideoGeneratingState';
import { describeFinalFilm } from './hooks/finalizeFilm';
import { useTopicSuggestions } from './hooks/useTopicSuggestions';
import {
  createFilmRow,
  depthFromRow,
  finalFromRow,
  findRecentUnfinishedFilm,
  getFilm,
  queueDepthBackground,
  queueRunState,
  queueStageUpdate,
  runFromRow,
  settingsFromRow,
  type FacelessFilmRow,
} from './lib/filmStore';
import {
  ASPECT_LIST,
  DEFAULT_SETTINGS,
  DURATION_PRESETS,
  LONG_RUN_WARNING_SECONDS,
  MAX_DURATION_SECONDS,
  MUSIC_MOODS,
  PROGRESS_PHASES,
  SEEDANCE_CLIP_COST_USD,
  VOICE_EFFECTS,
  VOICE_STYLES,
  aspectOf,
  estimateSecondsFor,
  estimatedRunSeconds,
  phaseForStage,
  sceneCountFor,
  targetWordsFor,
} from './lib/facelessOptions';
import { buildCaptionCues, cueAt, type CaptionCue } from './lib/captions';
import BeamBackground from '../../components/BeamBackground';
import GridOverlay from '../../components/GridOverlay';
import GlobalStyles from '../../components/ui/GlobalStyles';
import DepthStage, { type DepthAnnotation } from './components/DepthStage';
import { ToastStack, useToasts } from './components/ToastStack';
import { waitForDbSession } from '../../lib/reelioStudio';
import { withBrandContext } from '../../components/BrandContextLayer';

// ---------------------------------------------------------------------------

const STAGES: { id: PipelineStageId; label: string }[] = [
  { id: 'narration', label: 'Narration' },
  { id: 'analysis', label: 'Story structure' },
  { id: 'asset_index', label: 'Existing media' },
  { id: 'editorial', label: 'Editorial direction' },
  { id: 'visual_plan', label: 'Visual plan' },
  { id: 'assets', label: 'Assets' },
  { id: 'prepare', label: 'Preparation' },
  { id: 'motion', label: 'Motion plan' },
  { id: 'compile', label: 'FilmSpec' },
  { id: 'validate', label: 'Validation' },
  { id: 'render', label: 'Render' },
  { id: 'finalize', label: 'Finalise' },
];

const MODES: { id: FacelessMode | 'auto'; label: string; blurb: string }[] = [
  { id: 'auto', label: 'Decide for me', blurb: 'Read the script and pick the grammar' },
  { id: 'documentary', label: 'Documentary', blurb: 'Slow camera, archive, maps · unlocks the depth stage' },
  { id: 'explainer', label: 'Explainer', blurb: 'Diagrams and kinetic type lead' },
  { id: 'news', label: 'News', blurb: 'Fast cuts, headlines, screenshots' },
  { id: 'business', label: 'Business', blurb: 'Product UI, clean motion, numbers' },
  { id: 'story', label: 'Story', blurb: 'Cinematic images, sound design, drama' },
  { id: 'educational', label: 'Educational', blurb: 'Diagram-first, examples before concepts' },
];

const SAMPLE = [
  'Every eight minutes, somewhere in the world, a new undersea cable goes live.',
  'Most people have never thought about them. But ninety-nine percent of everything you have ever sent across the internet travelled through one.',
  'Not satellites. Cables. Bundles of glass the width of a garden hose, lying on the ocean floor.',
  'And the map of where they land has barely changed in a hundred and fifty years. The same harbours that carried telegraph wire in eighteen sixty-six carry fibre today.',
  'Which means the internet is not a cloud at all. It is a coastline.',
].join('\n');

const VIDEOS_TABLE = 'faceless_videos';

interface FacelessVideoRow {
  id: string;
  video_url: string;
  thumbnail_url: string | null;
  title: string | null;
  created_at: string;
}

function workspaceDbOrThrow(): any {
  const client = typeof window === 'undefined' ? null : (window as any).__workspaceDb;
  if (!client || typeof client.from !== 'function') {
    throw new Error('Your video history is not available in this context.');
  }
  return client;
}

async function listMyVideos(): Promise<FacelessVideoRow[]> {
  await waitForDbSession();
  const client = workspaceDbOrThrow();
  const [historyResult, previousRunsResult] = await Promise.all([
    client
      .from(VIDEOS_TABLE)
      .select('id', 'video_url', 'thumbnail_url', 'title', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(500)
      .get(),
    // Faceless already checkpointed complete runs before My Videos existed.
    // Include those rows so "history" really means previously generated work,
    // while all new completions are persisted in faceless_videos below.
    client
      .from('faceless_films')
      .select('id', 'topic', 'final_url', 'render_url', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(500)
      .get(),
  ]);

  const history = Array.isArray(historyResult?.data)
    ? historyResult.data as FacelessVideoRow[]
    : [];
  const seen = new Set(history.map((video) => video.video_url));
  const previousRuns = Array.isArray(previousRunsResult?.data) ? previousRunsResult.data : [];
  for (const row of previousRuns) {
    const videoUrl = row.final_url || row.render_url;
    if (!videoUrl || seen.has(videoUrl)) continue;
    history.push({
      id: `previous-${row.id}`,
      video_url: videoUrl,
      thumbnail_url: null,
      title: row.topic || 'Untitled film',
      created_at: row.created_at,
    });
    seen.add(videoUrl);
  }

  return history.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

async function saveVideoToHistory(videoUrl: string, title: string): Promise<boolean> {
  await waitForDbSession();
  const client = workspaceDbOrThrow();
  const existing = await client
    .from(VIDEOS_TABLE)
    .select('id')
    .eq('video_url', videoUrl)
    .limit(1)
    .get();
  if (Array.isArray(existing?.data) && existing.data.length > 0) return false;

  // WorkspaceDB stamps session_id, created_at and the UUID primary key from
  // the verified runtime session; the default read scope therefore behaves as
  // WHERE session_id = current session without exposing another user's rows.
  await client.from(VIDEOS_TABLE).insert({
    video_url: videoUrl,
    thumbnail_url: null,
    title: title.trim() || 'Untitled film',
  });
  return true;
}

async function copyPublicLink(url: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = url;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Copy is not supported in this browser.');
}

// ---------------------------------------------------------------------------

type Screen = 'brief' | 'running' | 'done';

interface StageView {
  state: StageState;
  label: string;
  detail?: string;
  progress?: number;
}

/**
 * Which grammar the film is actually being cut in. Before the analysis stage
 * runs this is only known when the user picked one explicitly.
 */
function resolvedStyle(run: FilmRunState | null, chosen: FacelessMode | 'auto'): FacelessMode | null {
  return run?.timeline?.mode || run?.analysis?.mode || (chosen === 'auto' ? null : chosen);
}

const BrandedFacelessApp = withBrandContext(FacelessApp, 'Faceless');
export default BrandedFacelessApp;
function FacelessApp() {
  const [screen, setScreen] = useState<Screen>('brief');
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [mode, setMode] = useState<FacelessMode | 'auto'>('auto');
  const [settings, setSettings] = useState<FilmSettings>(DEFAULT_SETTINGS);

  const [stages, setStages] = useState<Record<string, StageView>>({});
  const [log, setLog] = useState<string[]>([]);
  const [run, setRun] = useState<FilmRunState | null>(null);
  const [film, setFilm] = useState<FinalFilm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<FacelessFilmRow | null>(null);
  const [activeFilmId, setActiveFilmId] = useState<string | null>(null);
  const [depth, setDepth] = useState<DepthBackground | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [videos, setVideos] = useState<FacelessVideoRow[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [videosError, setVideosError] = useState<string | null>(null);

  const activeFilmIdRef = useRef<string | null>(null);
  const savedHistoryUrlsRef = useRef(new Set<string>());
  const logRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef<FilmSettings>(settings);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const patchSettings = useCallback((patch: Partial<FilmSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const refreshVideos = useCallback(async () => {
    setVideosLoading(true);
    setVideosError(null);
    try {
      setVideos(await listMyVideos());
    } catch (historyError: any) {
      console.warn('[Faceless] video history read failed:', historyError);
      setVideosError(String(historyError?.message || historyError));
    } finally {
      setVideosLoading(false);
    }
  }, []);

  const shareVideo = useCallback(async (url: string) => {
    try {
      await copyPublicLink(url);
      pushToast('Link copied! Anyone with this link can watch.', 'info');
    } catch (copyError: any) {
      pushToast(String(copyError?.message || 'Could not copy the link.'), 'warn');
    }
  }, [pushToast]);

  const wordCount = useMemo(() => script.trim().split(/\s+/).filter(Boolean).length, [script]);
  const estimateSeconds = estimateSecondsFor(wordCount);

  useEffect(() => {
    void refreshVideos();
  }, [refreshVideos]);

  useEffect(() => {
    const videoUrl = film?.mp4Url;
    if (!videoUrl || savedHistoryUrlsRef.current.has(videoUrl)) return;
    savedHistoryUrlsRef.current.add(videoUrl);
    void saveVideoToHistory(videoUrl, topic)
      .then(() => refreshVideos())
      .catch((historyError: any) => {
        savedHistoryUrlsRef.current.delete(videoUrl);
        console.warn('[Faceless] video history write failed:', historyError);
        pushToast('Your film is ready, but it could not be added to My Videos.', 'warn');
      });
  }, [film?.mp4Url, topic, refreshVideos, pushToast]);

  useEffect(() => {
    let cancelled = false;
    findRecentUnfinishedFilm().then((row) => {
      if (!cancelled) setResumeCandidate(row);
    }).catch((resumeError) => {
      console.warn('[Faceless] could not inspect recent runs:', resumeError);
    });
    return () => { cancelled = true; };
  }, []);

  // Background work outlives the pipeline promise — Seedance keeps polling
  // after the preview budget — so leaving the run has to stop it.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (screen !== 'running' || !activeFilmId) return;
    let cancelled = false;
    const poll = async () => {
      const row = await getFilm(activeFilmId);
      if (cancelled || !row) return;
      const restored = runFromRow(row);
      setRun(restored);
      setStages(stageViewsFrom(row.progress_log));
      setLog(activityFrom(row.progress_log));
      const storedDepth = depthFromRow(row);
      if (storedDepth) setDepth((previous) => previous || storedDepth);
      if (row.status === 'failed') setError(row.error_msg || 'The saved pipeline run stopped.');
      const savedFilm = finalFromRow(row);
      if (savedFilm) {
        if (!row.final_url) void queueRunState({ ...restored, final: savedFilm });
        setFilm(savedFilm);
        setScreen('done');
      }
    };
    void poll().catch((pollError) => console.warn('[Faceless] project refresh failed:', pollError));
    const timer = window.setInterval(() => {
      void poll().catch((pollError) => console.warn('[Faceless] project refresh failed:', pollError));
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [screen, activeFilmId]);

  const onStage = useCallback((update: StageUpdate) => {
    setStages((previous) => ({
      ...previous,
      [update.stage]: {
        state: update.state,
        label: update.label,
        detail: update.detail,
        progress: update.progress,
      },
    }));
    if (update.detail) {
      setLog((previous) => {
        const line = `${update.label} — ${update.detail}`;
        if (previous[previous.length - 1] === line) return previous;
        const next = [...previous, line].slice(-80);
        window.setTimeout(() => {
          const node = logRef.current;
          if (node) node.scrollTo({ top: node.scrollHeight });
        }, 0);
        return next;
      });
    }
    if (activeFilmIdRef.current) void queueStageUpdate(activeFilmIdRef.current, update);
  }, []);

  const onRunState = useCallback((state: FilmRunState) => {
    setRun(state);
    void queueRunState(state);
  }, []);

  const onDepthBackground = useCallback((background: DepthBackground) => {
    setDepth(background);
    if (activeFilmIdRef.current) {
      void queueDepthBackground(activeFilmIdRef.current, settingsRef.current, background);
    }
  }, []);

  const resumeSavedRun = useCallback((row: FacelessFilmRow) => {
    const restored = runFromRow(row);
    activeFilmIdRef.current = row.id;
    setActiveFilmId(row.id);
    setTopic(restored.input.topic);
    setScript(restored.input.script);
    setMode(restored.input.mode || 'auto');
    setSettings(settingsFromRow(row));
    setDepth(depthFromRow(row));
    setRun(restored);
    if (restored.final && !row.final_url) void queueRunState(restored);
    setStages(stageViewsFrom(row.progress_log));
    setLog(activityFrom(row.progress_log));
    setFilm(restored.final);
    setError(row.status === 'failed' ? row.error_msg || 'The saved pipeline run stopped.' : null);
    setResumeCandidate(null);
    setStartedAt(row.created_at ? new Date(row.created_at).getTime() : Date.now());
    setScreen(restored.final ? 'done' : 'running');
  }, []);

  const start = useCallback(async () => {
    const input = {
      script: script.trim(),
      topic: topic.trim() || 'Untitled film',
      mode: mode === 'auto' ? undefined : mode,
      settings,
    };
    const filmId = newFilmId();
    activeFilmIdRef.current = filmId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setActiveFilmId(filmId);
    setResumeCandidate(null);
    setScreen('running');
    setStages({});
    setLog([]);
    setFilm(null);
    setError(null);
    setRun(null);
    setDepth(null);
    setStartedAt(Date.now());
    try {
      await createFilmRow(filmId, input);
      const result = await createFacelessFilm(input, {
        filmId,
        onStage,
        onState: onRunState,
        onDepthBackground,
        onNotice: (message, tone) => pushToast(message, tone === 'warn' ? 'warn' : 'info'),
        signal: controller.signal,
      });
      setFilm(result);
      setScreen('done');
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, [script, topic, mode, settings, onStage, onRunState, onDepthBackground, pushToast]);

  const leaveRun = useCallback(() => {
    abortRef.current?.abort();
    setScreen('brief');
  }, []);

  const style = resolvedStyle(run, mode);

  return (
    // Faceless renders its own three-screen flow, so the dark-cosmic ground and
    // the beam layer are composed here rather than through AppShell.
    <div
      className="vv-app-shell h-full w-full overflow-y-auto"
      style={{
        position: 'relative',
        isolation: 'isolate',
        background: 'var(--space-surface-bg, #0D0B05)',
        color: 'var(--space-text-primary, #F5E9C8)',
      }}
    >
      <GlobalStyles />
      <BeamBackground />
      <GridOverlay />
      <div className="relative z-[1] mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
        <Header />
        {screen === 'brief' && (
          <div className="space-y-4">
            {resumeCandidate && (
              <Notice icon={<Clock className="h-4 w-4" />} tone="warn">
                <div className="font-medium">Resume “{resumeCandidate.topic || 'Untitled film'}”?</div>
                <div className="mt-1">A run from the last three hours has a saved checkpoint at {resumeCandidate.stage || 'the pipeline'}.</div>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => resumeSavedRun(resumeCandidate)}
                    className="font-semibold underline underline-offset-2"
                  >
                    Resume run
                  </button>
                  <button
                    type="button"
                    onClick={() => setResumeCandidate(null)}
                    className="underline underline-offset-2"
                  >
                    Start something new
                  </button>
                </div>
              </Notice>
            )}
            <BriefScreen
              topic={topic}
              setTopic={setTopic}
              script={script}
              setScript={setScript}
              mode={mode}
              setMode={setMode}
              settings={settings}
              patchSettings={patchSettings}
              wordCount={wordCount}
              estimateSeconds={estimateSeconds}
              onStart={start}
            />
          </div>
        )}
        {screen === 'running' && (
          <RunningScreen
            stages={stages}
            log={log}
            run={run}
            error={error}
            logRef={logRef}
            onBack={leaveRun}
            onRetry={start}
            settings={settings}
            style={style}
            depth={depth}
            script={script}
            startedAt={startedAt}
            onToggleCaptions={() => patchSettings({ captionsEnabled: !settings.captionsEnabled })}
          />
        )}
        {screen === 'done' && film && (
          <DoneScreen
            film={film}
            run={run}
            settings={settings}
            script={script}
            onToggleCaptions={() => patchSettings({ captionsEnabled: !settings.captionsEnabled })}
            onShare={shareVideo}
            onNew={() => setScreen('brief')}
          />
        )}
        <MyVideosPanel
          videos={videos}
          loading={videosLoading}
          error={videosError}
          onRefresh={refreshVideos}
          onShare={shareVideo}
        />
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function stageViewsFrom(progress: StageUpdate[] | null): Record<string, StageView> {
  const views: Record<string, StageView> = {};
  for (const update of Array.isArray(progress) ? progress : []) {
    views[update.stage] = {
      state: update.state,
      label: update.label,
      detail: update.detail,
      progress: update.progress,
    };
  }
  return views;
}

function activityFrom(progress: StageUpdate[] | null): string[] {
  const lines: string[] = [];
  for (const update of Array.isArray(progress) ? progress : []) {
    if (!update.detail) continue;
    const line = `${update.label} — ${update.detail}`;
    if (lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines.slice(-80);
}

// ---------------------------------------------------------------------------

function Header() {
  return (
    <header className="mb-7 flex items-start gap-3">
      <div
        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 16%, transparent)' }}
      >
        <Clapperboard className="h-5 w-5" style={{ color: 'var(--space-brand-primary-500, #D4920A)' }} />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Faceless</h1>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--space-text-secondary, #9E8B55)' }}>
          An AI editor that happens to generate footage. Your narration is recorded first, then every cut,
          camera move and piece of text is chosen against the words being spoken at that exact second.
        </p>
      </div>
    </header>
  );
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border p-5 ${className}`}
      style={{
        background: 'var(--space-surface-panel, #15120A)',
        borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))',
      }}
    >
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span
      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: 'var(--space-text-muted, #9E8B55)' }}
    >
      {children}
    </span>
  );
}

/** The shared selectable tile used by every option group on the brief. */
function OptionTile({
  active,
  onClick,
  title,
  blurb,
  icon,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb?: string;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border text-left transition-colors ${compact ? 'px-3 py-2' : 'px-3 py-2.5'}`}
      style={{
        borderColor: active
          ? 'var(--space-brand-primary-500, #D4920A)'
          : 'var(--space-border-default, rgba(255,255,255,0.07))',
        background: active
          ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)'
          : 'transparent',
      }}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </div>
      {blurb && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          {blurb}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------

interface BriefProps {
  topic: string;
  setTopic: (value: string) => void;
  script: string;
  setScript: (value: string) => void;
  mode: FacelessMode | 'auto';
  setMode: (value: FacelessMode | 'auto') => void;
  settings: FilmSettings;
  patchSettings: (patch: Partial<FilmSettings>) => void;
  wordCount: number;
  estimateSeconds: number;
  onStart: () => void;
}

function BriefScreen(props: BriefProps) {
  const { settings, patchSettings } = props;
  const tooShort = props.script.trim().length < 120;
  const overCeiling = props.estimateSeconds > MAX_DURATION_SECONDS;
  const shape = aspectOf(settings.aspect);
  const scenes = sceneCountFor(settings.targetDurationSeconds);
  const targetWords = targetWordsFor(settings.targetDurationSeconds);
  const suggestions = useTopicSuggestions(props.topic);

  return (
    <div className="space-y-4">
      <Panel>
        <Label>Topic</Label>
        <input
          value={props.topic}
          onChange={(event) => props.setTopic(event.target.value)}
          placeholder="What is this film about?"
          className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm outline-none"
          style={{
            borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))',
            color: 'var(--space-text-primary, #F5E9C8)',
          }}
        />

        {/* Suggestions are never load-bearing: a failure shows nothing at all. */}
        {(suggestions.loading || suggestions.suggestions.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {suggestions.loading && suggestions.suggestions.length === 0 ? (
              <span
                className="inline-flex items-center gap-1.5 text-[11px]"
                style={{ color: 'var(--space-text-muted, #9E8B55)' }}
              >
                <VergeLoader size={30} label="Finding angles" /> Finding angles…
              </span>
            ) : (
              suggestions.suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.kind}-${suggestion.text}`}
                  type="button"
                  onClick={() => props.setTopic(suggestion.text)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--space-brand-primary-500) 34%, transparent)',
                    background: 'color-mix(in srgb, var(--space-brand-primary-500) 8%, transparent)',
                    color: 'var(--space-text-secondary, #9E8B55)',
                  }}
                >
                  <span
                    className="font-semibold uppercase tracking-[0.1em]"
                    style={{ color: 'var(--space-brand-primary-500, #D4920A)' }}
                  >
                    {suggestion.kind}
                  </span>
                  {suggestion.text}
                </button>
              ))
            )}
          </div>
        )}

        <div className="mt-5 flex items-end justify-between gap-3">
          <Label>Narration script</Label>
          <button
            type="button"
            onClick={() => props.setScript(SAMPLE)}
            className="mb-2 text-xs underline-offset-2 hover:underline"
            style={{ color: 'var(--space-text-muted, #9E8B55)' }}
          >
            Use a sample script
          </button>
        </div>
        <textarea
          value={props.script}
          onChange={(event) => props.setScript(event.target.value)}
          rows={11}
          placeholder="Write the words the narrator will say. Everything else — shots, camera, text, music — is derived from this."
          className="w-full resize-y rounded-lg border bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none"
          style={{
            borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))',
            color: 'var(--space-text-primary, #F5E9C8)',
          }}
        />
        <p className="mt-2 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          {props.wordCount} words · roughly {props.estimateSeconds}s of narration · about{' '}
          {Math.max(4, Math.round(props.estimateSeconds / 3.1))} cuts
        </p>
      </Panel>

      <Panel>
        <Label>Shape</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {ASPECT_LIST.map((option) => (
            <OptionTile
              key={option.id}
              active={settings.aspect === option.id}
              onClick={() => patchSettings({ aspect: option.id })}
              title={`${option.label} (${option.id === 'portrait' ? '9:16' : '16:9'})`}
              blurb={option.blurb}
              icon={
                option.id === 'portrait'
                  ? <Smartphone className="h-3.5 w-3.5" />
                  : <Monitor className="h-3.5 w-3.5" />
              }
            />
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          Composed on a {shape.width}×{shape.height} canvas. Every image, clip and stock search is requested
          in this shape.
        </p>

        <div className="mt-5">
          <Label>Target length</Label>
          <div className="flex flex-wrap gap-2">
            {DURATION_PRESETS.map((preset) => (
              <OptionTile
                key={preset.seconds}
                compact
                active={settings.targetDurationSeconds === preset.seconds}
                onClick={() => patchSettings({ targetDurationSeconds: preset.seconds })}
                title={preset.label}
              />
            ))}
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
            {scenes} scenes · about {targetWords} words of script. The finished length is always the
            narration's real length, so this is the number to write to.
          </p>
          {settings.targetDurationSeconds >= LONG_RUN_WARNING_SECONDS && (
            <p className="mt-2 text-xs" style={{ color: 'var(--space-semantic-warning-500, #D4920A)' }}>
              A {Math.round(settings.targetDurationSeconds / 60)}-minute film takes noticeably longer to
              generate and costs more — expect to leave this running.
            </p>
          )}
        </div>
      </Panel>

      <Panel>
        <Label>Voice</Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {VOICE_STYLES.map((option) => (
            <OptionTile
              key={option.id}
              active={settings.voiceStyle === option.id}
              onClick={() => patchSettings({ voiceStyle: option.id })}
              title={option.label}
              blurb={option.blurb}
            />
          ))}
        </div>

        <div className="mt-4">
          <Label>Voice effect</Label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {VOICE_EFFECTS.map((option) => (
              <OptionTile
                key={option.id}
                compact
                active={settings.voiceEffect === option.id}
                onClick={() => patchSettings({ voiceEffect: option.id })}
                title={option.label}
                blurb={option.blurb}
                icon={option.id === 'none' ? undefined : <Mic className="h-3.5 w-3.5" />}
              />
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <Label>Music bed</Label>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {MUSIC_MOODS.map((option) => (
            <OptionTile
              key={option.id}
              compact
              active={settings.musicMood === option.id}
              onClick={() => patchSettings({ musicMood: option.id })}
              title={option.label}
              blurb={option.blurb}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Music className="h-4 w-4 shrink-0" style={{ color: 'var(--space-text-muted, #9E8B55)' }} />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.musicVolume * 100)}
            onChange={(event) => patchSettings({ musicVolume: Number(event.target.value) / 100 })}
            aria-label="Music volume"
            className="h-1 flex-1 cursor-pointer"
            style={{ accentColor: 'var(--space-brand-primary-500, #D4920A)' }}
          />
          <span className="w-10 text-right text-xs tabular-nums" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
            {Math.round(settings.musicVolume * 100)}%
          </span>
        </div>
        <p className="mt-1.5 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          The bed is mixed under the narration and follows each beat's energy; this is its ceiling, never
          its constant level.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Type className="h-3.5 w-3.5" /> Auto-captions
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
              Burned-in-looking caption pills in the player, synced to the narration
            </div>
          </div>
          <Switch
            checked={settings.captionsEnabled}
            onChange={(value) => patchSettings({ captionsEnabled: value })}
            label="Auto-captions"
          />
        </div>
      </Panel>

      <Panel>
        <Label>Mode grammar</Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((option) => (
            <OptionTile
              key={option.id}
              active={props.mode === option.id}
              onClick={() => props.setMode(option.id)}
              title={option.label}
              blurb={option.blurb}
            />
          ))}
        </div>

        {/*
          VOX 3-LAYER SYSTEM — Documentary only. Do not enable for other
          styles without founder approval. The stage itself is free; only the
          Seedance motion on its background layer is billed, so that part is
          an explicit choice with the price on it.
        */}
        <div className="mt-5 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Layers className="h-3.5 w-3.5" /> Animate the depth-stage background
            </div>
            <div className="mt-0.5 max-w-lg text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
              Documentary only. The three-layer stage always runs with a generated still behind it; this
              adds Seedance 2.0 image-to-video motion on that layer for about ${SEEDANCE_CLIP_COST_USD} a
              film, which is more than the rest of a short film costs put together.
            </div>
          </div>
          <Switch
            checked={settings.depthMotion}
            onChange={(value) => patchSettings({ depthMotion: value })}
            label="Animate the depth-stage background"
          />
        </div>
      </Panel>

      {overCeiling && (
        <Notice icon={<TriangleAlert className="h-4 w-4" />} tone="danger">
          <div className="font-medium">This script is too long for one film.</div>
          <div className="mt-1">
            It reads as roughly {props.estimateSeconds}s of narration and Faceless caps a film at{' '}
            {MAX_DURATION_SECONDS / 60} minutes. Cut it down or split it into two films.
          </div>
        </Notice>
      )}

      <button
        type="button"
        disabled={tooShort || overCeiling}
        onClick={props.onStart}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: 'var(--space-brand-primary-500, #D4920A)',
          color: 'var(--space-text-on-primary, #ffffff)',
        }}
      >
        <Sparkles className="h-4 w-4" />
        {overCeiling
          ? 'Shorten the script to begin'
          : tooShort
            ? 'Write a little more script to begin'
            : 'Direct this film'}
      </button>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{
        background: checked
          ? 'var(--space-brand-primary-500, #D4920A)'
          : 'var(--space-surface-muted, #18150A)',
        border: '1px solid var(--space-border-default, rgba(255,255,255,0.07))',
      }}
    >
      <span
        className="absolute top-0.5 rounded-full transition-transform"
        style={{
          height: 18,
          width: 18,
          left: 2,
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
          background: checked ? 'var(--space-text-on-primary, #ffffff)' : 'var(--space-text-muted, #9E8B55)',
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Captions and the depth stage
// ---------------------------------------------------------------------------

function useCaptionIndex(cues: CaptionCue[], seconds: number): number {
  const previous = useRef(0);
  return useMemo(() => {
    const index = cueAt(cues, seconds, previous.current);
    if (index >= 0) previous.current = index;
    return index;
  }, [cues, seconds]);
}

/** Chapter label, callout and supporting line, one per beat. */
function annotationsFrom(run: FilmRunState | null): DepthAnnotation[] {
  const beats = run?.timeline?.beats || [];
  return beats.map((beat) => {
    const emphasis = (beat.emphasisWords || []).filter(Boolean);
    const callout =
      beat.textOverlay?.content
      || (emphasis.length ? emphasis.slice(0, 4).join(' · ') : '')
      || beat.narrationText.split(/\s+/).slice(0, 8).join(' ');
    return {
      id: beat.id,
      label: beat.narrativePurpose.replace(/_/g, ' '),
      value: callout,
      detail: beat.visualIntent,
    };
  });
}

function beatIndexAt(run: FilmRunState | null, seconds: number): number {
  const beats = run?.timeline?.beats || [];
  for (let i = 0; i < beats.length; i += 1) {
    if (seconds >= beats[i].narrationStart && seconds < beats[i].narrationEnd) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Three-phase progress
// ---------------------------------------------------------------------------

function currentStageId(stages: Record<string, StageView>): PipelineStageId {
  let latest: PipelineStageId = 'narration';
  for (const stage of STAGES) {
    const view = stages[stage.id];
    if (!view) continue;
    if (view.state === 'active' || view.state === 'done' || view.state === 'failed') latest = stage.id;
    if (view.state === 'active') return stage.id;
  }
  return latest;
}

function PhaseProgress({
  stages,
  startedAt,
  targetSeconds,
  failed,
}: {
  stages: Record<string, StageView>;
  startedAt: number | null;
  targetSeconds: number;
  failed: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (failed) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [failed]);

  const active = currentStageId(stages);
  const activePhase = phaseForStage(active);
  const activeIndex = PROGRESS_PHASES.findIndex((phase) => phase.id === activePhase);

  // Fraction of the whole run: completed phases at full weight, plus the
  // completed share of the phase that is running.
  const withinPhase = (() => {
    const phase = PROGRESS_PHASES[activeIndex];
    if (!phase) return 0;
    const doneCount = phase.stages.filter((id) => stages[id]?.state === 'done').length;
    const stageProgress = stages[active]?.progress;
    const partial = typeof stageProgress === 'number' ? Math.max(0, Math.min(1, stageProgress)) : 0.35;
    return Math.min(1, (doneCount + partial) / phase.stages.length);
  })();

  const fraction = PROGRESS_PHASES.slice(0, Math.max(0, activeIndex)).reduce(
    (sum, phase) => sum + phase.weight,
    0,
  ) + (PROGRESS_PHASES[activeIndex]?.weight || 0) * withinPhase;

  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const total = estimatedRunSeconds(targetSeconds);
  // Driven by real progress rather than by the clock, so it never sits at
  // "10s left" through a long asset phase and never claims to be nearly done.
  const remaining = Math.max(20, Math.round(total * (1 - Math.min(0.95, fraction))));

  return (
    <Panel>
      {failed ? (
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <AlertCircle className="h-4 w-4" style={{ color: 'var(--space-semantic-danger-500, #ef4444)' }} />
          The run stopped
        </div>
      ) : (
        <VideoGeneratingState
          label={PROGRESS_PHASES[activeIndex]?.label || PROGRESS_PHASES[0].label}
          detail={`${stages[active]?.label || 'Starting'}${stages[active]?.detail ? ` — ${stages[active]?.detail}` : ''} · about ${formatDuration(remaining)} left`}
          progress={fraction * 100}
          elapsedSeconds={elapsed}
          compact
          style={{ marginBottom: 14 }}
        />
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {PROGRESS_PHASES.map((phase, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          const fill = state === 'done' ? 1 : state === 'active' ? Math.max(0.06, withinPhase) : 0;
          return (
            <div key={phase.id}>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--space-surface-muted, #18150A)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round(fill * 100)}%`,
                    background: failed && state === 'active'
                      ? 'var(--space-semantic-danger-500, #ef4444)'
                      : 'var(--space-brand-primary-500, #D4920A)',
                  }}
                />
              </div>
              <div
                className="mt-1.5 flex items-center gap-1 text-[10px] leading-tight"
                style={{
                  color: state === 'pending'
                    ? 'var(--space-text-muted, #9E8B55)'
                    : 'var(--space-text-secondary, #9E8B55)',
                }}
              >
                {state === 'done' && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                {state === 'active' && !failed && <VergeLoader size={28} style={{ flexShrink: 0 }} label={phase.label} />}
                <span className="truncate">{phase.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

// ---------------------------------------------------------------------------

function RunningScreen({
  stages,
  log,
  run,
  error,
  logRef,
  onBack,
  onRetry,
  settings,
  style,
  depth,
  script,
  startedAt,
  onToggleCaptions,
}: {
  stages: Record<string, StageView>;
  log: string[];
  run: FilmRunState | null;
  error: string | null;
  logRef: MutableRefObject<HTMLDivElement | null>;
  onBack: () => void;
  onRetry: () => void;
  settings: FilmSettings;
  style: FacelessMode | null;
  depth: DepthBackground | null;
  script: string;
  startedAt: number | null;
  onToggleCaptions: () => void;
}) {
  // A render that already succeeded is not lost if finalisation itself fails.
  // Rendering is the expensive step, so the completed output remains available.
  const lastRender = run?.renders?.length ? run.renders[run.renders.length - 1] : null;
  const shape = aspectOf(settings.aspect);

  return (
    <div className="space-y-4">
      {error && (
        <div>
          <VideoErrorCard
            error={error}
            subject="this faceless film"
            onRetry={() => void onRetry()}
          />
          <button
            type="button"
            onClick={onBack}
            className="mt-2 inline-flex items-center gap-1.5 text-xs underline underline-offset-2"
          >
            <ArrowLeft className="h-3 w-3" /> Back to the brief
          </button>
        </div>
      )}

      <PhaseProgress
        stages={stages}
        startedAt={startedAt}
        targetSeconds={settings.targetDurationSeconds}
        failed={Boolean(error)}
      />

      {/*
        VOX 3-LAYER SYSTEM — Documentary only. Do not enable for other styles
        without founder approval. Every other grammar runs the existing clean
        pipeline with no depth stage at all.
      */}
      {style === 'documentary' && (
        <DepthComposition
          run={run}
          depth={depth}
          settings={settings}
          script={script}
          onToggleCaptions={onToggleCaptions}
        />
      )}

      {error && lastRender && (
        <Panel className="overflow-hidden !p-0">
          <video
            src={lastRender.mp4Url}
            controls
            playsInline
            className="w-full"
            style={{ background: '#000', aspectRatio: shape.css }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="max-w-md text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
              This film had already finished rendering when the run stopped, so it is yours to keep.
            </p>
            <a
              href={lastRender.mp4Url}
              download
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold"
              style={{
                background: 'var(--space-brand-primary-500, #D4920A)',
                color: 'var(--space-text-on-primary, #ffffff)',
              }}
            >
              <Download className="h-4 w-4" /> Download MP4
            </a>
          </div>
        </Panel>
      )}

      <Panel>
        <Label>Pipeline</Label>
        <ol className="space-y-1">
          {STAGES.map((stage) => {
            const view = stages[stage.id];
            const state = view?.state || 'pending';
            return (
              <li key={stage.id} className="flex items-start gap-2.5 py-1">
                <StageIcon state={state} />
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm"
                    style={{
                      color:
                        state === 'pending'
                          ? 'var(--space-text-muted, #9E8B55)'
                          : 'var(--space-text-primary, #F5E9C8)',
                      fontWeight: state === 'active' ? 600 : 400,
                    }}
                  >
                    {view?.label || stage.label}
                  </div>
                  {view?.detail && (
                    <div className="mt-0.5 break-words text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
                      {view.detail}
                    </div>
                  )}
                  {typeof view?.progress === 'number' && state === 'active' && (
                    <div
                      className="mt-1.5 h-1 w-full overflow-hidden rounded-full"
                      style={{ background: 'var(--space-surface-muted, #18150A)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.round(Math.max(0, Math.min(1, view.progress)) * 100)}%`,
                          background: 'var(--space-brand-primary-500, #D4920A)',
                        }}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      {run?.timeline && <DecisionPanel run={run} />}

      {log.length > 0 && (
        <Panel>
          <Label>Activity</Label>
          <div
            ref={logRef}
            className="max-h-48 overflow-y-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed"
            style={{ background: 'var(--space-surface-muted, #18150A)', color: 'var(--space-text-secondary, #9E8B55)' }}
          >
            {log.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/**
 * VOX 3-LAYER SYSTEM — Documentary only. Do not enable for other styles
 * without founder approval.
 *
 * The narration exists from the first stage, long before the film does, so
 * this panel lets the user hear it over the Seedance background while the
 * assets are still generating. Playback drives both the caption pills and
 * which midground annotation is on screen; with nothing playing, the
 * annotations cycle on their own so the stage is never static.
 */
function DepthComposition({
  run,
  depth,
  settings,
  script,
  onToggleCaptions,
}: {
  run: FilmRunState | null;
  depth: DepthBackground | null;
  settings: FilmSettings;
  script: string;
  onToggleCaptions: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [cycle, setCycle] = useState(0);

  const narrationUrl = run?.narration?.audioUrl || null;
  const annotations = useMemo(() => annotationsFrom(run), [run]);
  const cues = useMemo(
    () => buildCaptionCues(run?.narration?.wordTimestamps, run?.input?.script || script, run?.narration?.duration || 0),
    [run?.narration?.wordTimestamps, run?.narration?.duration, run?.input?.script, script],
  );
  const captionIndex = useCaptionIndex(cues, time);

  useEffect(() => {
    if (playing || annotations.length < 2) return undefined;
    const timer = window.setInterval(() => setCycle((value) => value + 1), 3500);
    return () => window.clearInterval(timer);
  }, [playing, annotations.length]);

  const activeIndex = (() => {
    if (!annotations.length) return 0;
    if (playing) {
      const index = beatIndexAt(run, time);
      if (index >= 0) return index;
    }
    return cycle % annotations.length;
  })();

  const toggle = () => {
    const node = audioRef.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => setPlaying(false));
    else node.pause();
  };

  const motionState = !depth
    ? 'Generating the background plate\u2026'
    : depth.videoUrl
      ? 'Seedance 2.0 motion'
      : settings.depthMotion
        ? 'Still plate — motion unavailable'
        : 'Still plate — motion off';

  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Label>Depth stage</Label>
        <div className="mb-2 flex items-center gap-2">
          {narrationUrl && (
            <button
              type="button"
              onClick={toggle}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
              style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))' }}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? 'Pause narration' : 'Play narration'}
            </button>
          )}
          <CaptionToggle enabled={settings.captionsEnabled} onToggle={onToggleCaptions} />
        </div>
      </div>

      <DepthStage
        aspect={settings.aspect}
        background={depth}
        annotations={annotations}
        activeIndex={activeIndex}
        caption={captionIndex >= 0 ? cues[captionIndex]?.text : null}
        captionsEnabled={settings.captionsEnabled}
        status={
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
            style={{ background: 'rgba(8,10,16,0.66)', color: '#e2e8f0', backdropFilter: 'blur(6px)' }}
          >
            <Layers className="h-3 w-3" />
            {motionState}
          </span>
        }
      />

      {narrationUrl && (
        <audio
          ref={audioRef}
          src={narrationUrl}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          className="hidden"
        />
      )}

      <p className="mt-3 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
        Three layers: a Seedance 2.0 background, floating midground annotations drawn from the edit, and a
        foreground of vignette and captions. This is the composition surface — the film itself keeps the
        grammar the director chose.
      </p>
    </Panel>
  );
}

function CaptionToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
      style={{
        borderColor: enabled
          ? 'var(--space-brand-primary-500, #D4920A)'
          : 'var(--space-border-default, rgba(255,255,255,0.07))',
        background: enabled
          ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)'
          : 'transparent',
      }}
    >
      <Type className="h-3.5 w-3.5" />
      Captions {enabled ? 'on' : 'off'}
    </button>
  );
}

function StageIcon({ state }: { state: StageState }) {
  const base = 'mt-0.5 h-4 w-4 shrink-0';
  if (state === 'active') {
    return <VergeLoader size={36} style={{ flexShrink: 0 }} label="In progress" />;
  }
  if (state === 'done') {
    return <CheckCircle2 className={base} style={{ color: 'var(--space-semantic-success-500, #22c55e)' }} />;
  }
  if (state === 'failed') {
    return <AlertCircle className={base} style={{ color: 'var(--space-semantic-danger-500, #ef4444)' }} />;
  }
  if (state === 'skipped') {
    return <TriangleAlert className={base} style={{ color: 'var(--space-text-muted, #9E8B55)' }} />;
  }
  return <Clock className={base} style={{ color: 'var(--space-text-muted, #9E8B55)' }} />;
}

/** The editorial decisions, shown while they are being made rather than after. */
function DecisionPanel({ run }: { run: FilmRunState }) {
  const timeline = run.timeline;
  const plan = run.visualPlan;
  if (!timeline) return null;

  return (
    <Panel>
      <Label>The edit</Label>
      <p className="mb-3 text-xs" style={{ color: 'var(--space-text-secondary, #9E8B55)' }}>
        {timeline.continuityGuide.colorStory} · {timeline.continuityGuide.visualMotif} ·{' '}
        {timeline.continuityGuide.cameraGrammar}
      </p>

      {plan && (plan.downgrades.length > 0 || plan.noveltyDeviations.length > 0) && (
        <div className="mb-3 space-y-1 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          {plan.downgrades.map((entry) => (
            <div key={`d-${entry.beatId}`}>
              Beat {entry.beatId}: tier {entry.from} → {entry.to}. {entry.reason}
            </div>
          ))}
          {plan.noveltyDeviations.map((entry) => (
            <div key={`n-${entry.beatId}`}>
              Beat {entry.beatId}: {entry.from} → {entry.to}. {entry.reason}
            </div>
          ))}
        </div>
      )}

      <div className="max-h-72 space-y-1.5 overflow-y-auto">
        {timeline.beats.map((beat) => {
          const asset = run.resolvedAssets[beat.id];
          return (
            <div key={beat.id} className="rounded-lg px-3 py-2" style={{ background: 'var(--space-surface-muted, #18150A)' }}>
              <div
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
                style={{ color: 'var(--space-text-muted, #9E8B55)' }}
              >
                <span style={{ color: 'var(--space-text-brand, #fbbf24)' }}>
                  {beat.narrationStart.toFixed(1)}–{beat.narrationEnd.toFixed(1)}s
                </span>
                <span>{beat.visualType}</span>
                <span>{beat.camera.type}</span>
                <span>
                  tier {asset ? asset.tier : beat.assetDecision.tier}
                  {asset ? '' : ' · pending'}
                </span>
                {beat.isHook && <span style={{ color: 'var(--space-text-brand, #fbbf24)' }}>hook</span>}
                {beat.transition?.type === 'match_cut' && <span>match cut</span>}
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--space-text-secondary, #9E8B55)' }}>
                {beat.visualIntent}
              </div>
              {beat.textOverlay && (
                <div className="mt-1 text-[11px]" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
                  text ({beat.textOverlay.type}): {beat.textOverlay.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function DoneScreen({
  film,
  run,
  settings,
  script,
  onToggleCaptions,
  onShare,
  onNew,
}: {
  film: FinalFilm;
  run: FilmRunState | null;
  settings: FilmSettings;
  script: string;
  onToggleCaptions: () => void;
  onShare: (url: string) => void;
  onNew: () => void;
}) {
  const shape = aspectOf(settings.aspect);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);

  const cues = useMemo(
    () =>
      buildCaptionCues(
        run?.narration?.wordTimestamps,
        run?.input?.script || script,
        film.durationSeconds || run?.narration?.duration || 0,
      ),
    [run?.narration?.wordTimestamps, run?.narration?.duration, run?.input?.script, script, film.durationSeconds],
  );
  const captionIndex = useCaptionIndex(cues, time);
  const caption = settings.captionsEnabled && captionIndex >= 0 ? cues[captionIndex]?.text : null;

  const voice = VOICE_STYLES.find((entry) => entry.id === settings.voiceStyle);
  const effect = VOICE_EFFECTS.find((entry) => entry.id === settings.voiceEffect);
  const mood = MUSIC_MOODS.find((entry) => entry.id === settings.musicMood);

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden !p-0">
        <div className="relative mx-auto" style={{ maxWidth: settings.aspect === 'portrait' ? 420 : undefined }}>
          <video
            ref={videoRef}
            src={film.mp4Url}
            controls
            playsInline
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            className="w-full"
            style={{ background: '#000', aspectRatio: shape.css, display: 'block' }}
          />
          {caption && (
            // Clear of the native control bar, which owns the bottom ~48px.
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-14">
              <span
                className="max-w-[92%] rounded-xl px-3 py-1.5 text-center"
                style={{
                  background: 'rgba(8,10,16,0.72)',
                  color: '#ffffff',
                  fontSize: 16,
                  lineHeight: 1.38,
                  backdropFilter: 'blur(6px)',
                }}
              >
                {caption}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
              {describeFinalFilm(film)}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
              {shape.label} {shape.width}×{shape.height} · {voice?.label || 'default'} voice
              {effect && effect.id !== 'none' ? ` + ${effect.label}` : ''} · {mood?.label || 'Documentary'} bed at{' '}
              {Math.round(settings.musicVolume * 100)}%
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CaptionToggle enabled={settings.captionsEnabled} onToggle={onToggleCaptions} />
            <a
              href={film.mp4Url}
              download
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold"
              style={{
                background: 'var(--space-brand-primary-500, #D4920A)',
                color: 'var(--space-text-on-primary, #ffffff)',
              }}
            >
              <Download className="h-4 w-4" /> Download MP4
            </a>
            <button
              type="button"
              onClick={() => onShare(film.mp4Url)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))' }}
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button
              type="button"
              onClick={onNew}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))' }}
            >
              <Wand2 className="h-4 w-4" /> New film
            </button>
          </div>
        </div>
      </Panel>

      {run?.timeline && <DecisionPanel run={run} />}
    </div>
  );
}

function MyVideosPanel({
  videos,
  loading,
  error,
  onRefresh,
  onShare,
}: {
  videos: FacelessVideoRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onShare: (url: string) => void;
}) {
  return (
    <Panel className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Label>My Videos</Label>
          <p className="text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
            Your finished films, newest first.
          </p>
        </div>
        {error && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))' }}
          >
            Try again
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          <VergeLoader size={36} label="Loading your videos" /> Loading your videos…
        </div>
      ) : error ? (
        <p className="py-6 text-sm" style={{ color: 'var(--space-semantic-danger-500, #ef4444)' }}>
          My Videos could not be loaded. {error}
        </p>
      ) : videos.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
          No videos yet — generate your first one above!
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {videos.map((video) => (
            <article
              key={video.id}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))' }}
            >
              <video
                src={video.video_url}
                poster={video.thumbnail_url || undefined}
                controls
                muted
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black object-contain"
              />
              <div className="space-y-3 p-3">
                <div>
                  <h3 className="truncate text-sm font-medium">{video.title || 'Untitled film'}</h3>
                  <p className="mt-1 text-xs" style={{ color: 'var(--space-text-muted, #9E8B55)' }}>
                    {formatVideoDate(video.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={video.video_url}
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{
                      background: 'var(--space-brand-primary-500, #D4920A)',
                      color: 'var(--space-text-on-primary, #ffffff)',
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  <button
                    type="button"
                    onClick={() => onShare(video.video_url)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs"
                    style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,0.07))' }}
                  >
                    <Share2 className="h-3.5 w-3.5" /> Share
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function formatVideoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// ---------------------------------------------------------------------------

function Notice({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  tone: 'warn' | 'danger';
}) {
  // Tailwind silently drops an opacity modifier applied to a CSS variable, so
  // every tint here is a color-mix instead.
  const colour = tone === 'danger' ? 'var(--space-semantic-danger-500)' : 'var(--space-brand-primary-500)';
  return (
    <div
      className="flex gap-2.5 rounded-xl border px-4 py-3 text-xs leading-relaxed"
      style={{
        background: `color-mix(in srgb, ${colour} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${colour} 38%, transparent)`,
        color: 'var(--space-text-secondary, #9E8B55)',
      }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: colour }}>
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
