// THE DIRECTOR — SceneForge's explanatory-video surface.
//
//     script -> LLM visual director -> SceneSpec[]
//                   |                      |
//                   |                      +-> Remotion visual scenes
//                   +-> HeyGen narration ------+
//                                              v
//                                       one composited MP4
//
// The whole system is data-driven and subject-agnostic. Nothing here knows
// what the film is ABOUT: the director decides which visual grammar explains
// each line, the plan drives Remotion, and Remotion builds the picture from
// code. The same flow makes a biology explainer, a history documentary and a
// compound-interest breakdown.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clapperboard, Download, Film, FolderOpen, Loader2, Pause, Play, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { analyzeScriptForVisuals, estimateScriptSeconds, fallbackPlan, fitSpecsToDuration, totalDurationSec } from '../lib/sceneSpec';
import { measureAudioSeconds, startNarration, waitForNarration } from '../lib/directorNarration';
import { resolveSceneImages } from '../lib/visualAssets';
import { MAX_FILM_SECONDS, pollDirectorRender, previewSource, submitDirectorRender } from '../lib/directorRender';
import { clearSession, EMPTY_SESSION, loadSession, saveSession, type DirectorSession } from '../lib/directorSession';
import { directorOwnerKey, getDirectorFilm, hasDirectorWork, listDirectorFilms, saveDirectorFilm, titleFor, type DirectorFilmSummary, type DirectorStatus } from '../lib/directorStore';
import { downloadVideo } from '../lib/heygenStudio';
import { consumeVidvergeHandoff } from '../../../lib/vidvergeHandoff';
import { useSpaceRuntime } from '../../../SpaceRuntimeContext';
import FilmStage from './visuals/FilmStage';
import NarratorPicker from './director/NarratorPicker';
import SpecBoard from './director/SpecBoard';

type Stage = 'idle' | 'analyzing' | 'narrating' | 'assets' | 'rendering' | 'done' | 'failed';

interface LogLine {
  id: number;
  text: string;
  state: 'running' | 'done' | 'failed';
}

const ACCENTS = ['#4FC3F7', '#F2C14E', '#D4920A', '#38D39F', '#FF6B6B'];

const panel = 'rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]';

export default function DirectorStudio({ onBack }: { onBack?: () => void }) {
  const { subscription, subscriptionReady, sessionId } = useSpaceRuntime();
  const accountIdentity = subscriptionReady ? String(subscription?.email || sessionId || '') : '';
  const [session, setSession] = useState<DirectorSession>(loadSession);
  const [stage, setStage] = useState<Stage>(session.filmUrl ? 'done' : 'idle');
  const [films, setFilms] = useState<DirectorFilmSummary[]>([]);
  const [filmsLoading, setFilmsLoading] = useState(true);
  const [syncError, setSyncError] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [seek, setSeek] = useState({ token: 0, sec: 0 });
  const [previewTime, setPreviewTime] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const cancelled = useRef(false);
  const logId = useRef(0);
  const hydrated = useRef(false);
  const saveTimer = useRef(0);
  const persistChain = useRef<Promise<void>>(Promise.resolve());
  const recordId = useRef<number | null>(session.filmId);
  const ownerKey = useRef(session.ownerKey);
  const sessionGeneration = useRef(0);

  const refreshFilms = useCallback(async () => {
    if (!ownerKey.current) return;
    try {
      setFilms(await listDirectorFilms(ownerKey.current));
      setSyncError('');
    } catch (e: any) {
      setSyncError(String(e?.message || 'Your saved films could not be loaded.'));
    } finally {
      setFilmsLoading(false);
    }
  }, []);

  // WorkspaceDB wins over the cache when both know the active film. A handoff
  // from Recent Jobs names the exact row to open.
  useEffect(() => {
    if (!accountIdentity) return;
    let disposed = false;
    const hydrate = async () => {
      let selected = loadSession();
      try {
        const key = await directorOwnerKey(accountIdentity);
        ownerKey.current = key;
        if (selected.ownerKey && selected.ownerKey !== key) selected = { ...EMPTY_SESSION, ownerKey: key };
        const handoff = consumeVidvergeHandoff('sceneforge');
        const requestedId = handoff?.surface === 'director' ? handoff.projectId : null;
        const targetId = requestedId != null ? requestedId : selected.filmId;
        if (targetId != null) {
          const remote = await getDirectorFilm(targetId, key);
          if (!remote) throw new Error('That film is not available for this account.');
          selected = remote;
        } else {
          selected = { ...selected, ownerKey: key };
        }
      } catch (e: any) {
        selected = { ...EMPTY_SESSION, ownerKey: ownerKey.current };
        setSyncError(String(e?.message || 'The saved film could not be restored for this account.'));
      }
      if (disposed) return;
      sessionGeneration.current += 1;
      recordId.current = selected.filmId;
      setSession(selected);
      setStage(selected.filmUrl ? 'done' : 'idle');
      saveSession(selected);
      hydrated.current = true;
      await refreshFilms();
    };
    void hydrate();
    return () => { disposed = true; };
  }, [accountIdentity, refreshFilms]);

  // localStorage is written synchronously for instant reloads. WorkspaceDB is
  // debounced and serialized so typing never creates duplicate film rows.
  useEffect(() => {
    saveSession(session);
    if (!hydrated.current || !ownerKey.current || !hasDirectorWork(session)) return;
    window.clearTimeout(saveTimer.current);
    const key = ownerKey.current;
    const snapshot = { ...session, filmId: session.filmId || recordId.current, ownerKey: key };
    const generation = sessionGeneration.current;
    saveTimer.current = window.setTimeout(() => {
      persistChain.current = persistChain.current.catch(() => undefined).then(async () => {
        try {
          const id = await saveDirectorFilm(snapshot, key);
          if (id && sessionGeneration.current === generation) {
            recordId.current = id;
            setSession((current) => current.filmId ? current : { ...current, filmId: id, ownerKey: ownerKey.current });
          }
          await refreshFilms();
        } catch (e: any) {
          setSyncError(String(e?.message || 'This film is cached locally but has not synced yet.'));
        }
      });
    }, 850);
    return () => window.clearTimeout(saveTimer.current);
  }, [session, refreshFilms]);

  const patch = useCallback((change: Partial<DirectorSession>) => {
    setSession((current) => ({ ...current, ...change }));
  }, []);

  const moveStage = useCallback((next: Stage, persisted?: DirectorStatus) => {
    setStage(next);
    patch({ status: persisted || (next === 'idle' ? 'draft' : next) });
  }, [patch]);

  const openFilm = useCallback(async (id: number) => {
    setSyncError('');
    try {
      const restored = await getDirectorFilm(id, ownerKey.current);
      if (!restored) throw new Error('That film could not be found.');
      sessionGeneration.current += 1;
      recordId.current = restored.filmId;
      setSession(restored);
      saveSession(restored);
      setStage(restored.filmUrl ? 'done' : 'idle');
      setLog([]);
      setError('');
      setWarnings([]);
      setPreviewTime(0);
    } catch (e: any) {
      setSyncError(String(e?.message || 'That film could not be opened.'));
    }
  }, []);

  const note = useCallback((text: string): number => {
    logId.current += 1;
    const id = logId.current;
    setLog((lines) => [...lines, { id, text, state: 'running' }]);
    return id;
  }, []);
  const settle = useCallback((id: number, state: 'done' | 'failed', text?: string) => {
    setLog((lines) => lines.map((line) => (line.id === id ? { ...line, state, ...(text ? { text } : {}) } : line)));
  }, []);

  const busy = stage !== 'idle' && stage !== 'done' && stage !== 'failed';
  const estimate = useMemo(() => estimateScriptSeconds(session.script), [session.script]);
  const planned = useMemo(() => totalDurationSec(session.specs), [session.specs]);
  const readyToNarrate = Boolean(session.avatarId) && (session.useCustomVoice ? Boolean(session.customVoice) : Boolean(session.voiceId));

  // ---- Step 3: analyse -----------------------------------------------
  const analyze = async () => {
    setError('');
    setWarnings([]);
    moveStage('analyzing');
    const id = note('Reading the script and directing the visuals\u2026');
    try {
      // When the narration already exists its measured length is the truth the
      // plan should be written against, not a word-count guess.
      const known = session.narrationSec
        || (session.useCustomVoice && session.customVoice ? await measureAudioSeconds(session.customVoice.url) : 0);
      const specs = await analyzeScriptForVisuals(session.script, {
        notes: session.notes,
        targetDurationSec: known || undefined,
      });
      const fitted = known ? fitSpecsToDuration(specs, known) : specs;
      patch({ specs: fitted, filmUrl: '', renderOperationId: '' });
      settle(id, 'done', `Directed ${fitted.length} scenes across ${totalDurationSec(fitted).toFixed(1)}s.`);
      moveStage('idle');
    } catch (e: any) {
      settle(id, 'failed', `Visual direction failed: ${String(e?.message || e)}`);
      setError(String(e?.message || e));
      moveStage('idle', 'failed');
    }
  };

  const useFallback = () => {
    const specs = fallbackPlan(session.script);
    patch({ specs, filmUrl: '', renderOperationId: '' });
    setWarnings(['This plan was cut mechanically from your sentences, not directed. Every scene is a word highlight — analyse again when the director is available for a real plan.']);
  };

  // ---- Steps 4 & 5: narrate, resolve pictures, render ------------------
  const generate = async () => {
    setError('');
    setWarnings([]);
    cancelled.current = false;
    let specs = session.specs;

    try {
      // 1. NARRATION. One take for the whole script, reused on a re-render.
      let narrationUrl = session.narrationUrl;
      let narrationSec = session.narrationSec;
      if (!narrationUrl) {
        moveStage('narrating');
        const id = note(session.narrationVideoId ? 'Reconnecting to the existing narration render\u2026' : 'Rendering the narration with your presenter\u2026');
        let narrationVideoId = session.narrationVideoId;
        let narrationApi = session.narrationApi || 'v3';
        if (!narrationVideoId) {
          const created = await startNarration({
            avatarId: session.avatarId,
            voiceId: session.voiceId,
            script: session.script,
            speed: session.speed,
            customVoiceUrl: session.useCustomVoice ? session.customVoice?.url : undefined,
            backgroundColor: '#0D0D0D',
          });
          narrationVideoId = created.videoId;
          narrationApi = created.apiVersion;
          patch({ narrationVideoId, narrationApi });
        }
        const result = await waitForNarration(narrationVideoId, narrationApi, {
          onStatus: (status, elapsed) => setLog((lines) => lines.map((line) => (line.id === id ? { ...line, text: `Rendering the narration (${status}, ${elapsed}s)\u2026` } : line))),
          isCancelled: () => cancelled.current,
        });
        narrationUrl = result.videoUrl;
        narrationSec = result.durationSec;
        settle(id, 'done', `Narration ready${narrationSec ? ` — ${narrationSec.toFixed(1)}s` : ''}.`);
        patch({ narrationUrl, narrationSec });
      }

      // 2. FIT. The plan is stretched onto the narration's real runtime so a
      // graphic lands on the words it explains instead of near them.
      if (narrationSec > 0) {
        const fitted = fitSpecsToDuration(specs, narrationSec);
        if (fitted !== specs) {
          specs = fitted;
          patch({ specs: fitted });
          note(`Timed the plan to the narration (${narrationSec.toFixed(1)}s).`);
          settle(logId.current, 'done');
        }
      }

      // 3. PICTURES for the image scenes.
      const needsImages = specs.some((spec) => spec.visual.type === 'image_kenburns' && !spec.visual.imageUrl);
      if (needsImages && !cancelled.current) {
        moveStage('assets');
        const id = note('Finding the pictures\u2026');
        const resolved = await resolveSceneImages(specs, {
          prefer: session.imageSource,
          isCancelled: () => cancelled.current,
          onProgress: (done, total, label) => setLog((lines) => lines.map((line) => (line.id === id ? { ...line, text: `${label} (${done}/${total})` } : line))),
        });
        specs = resolved.specs;
        patch({ specs });
        settle(id, 'done', `Pictures ready for ${resolved.resolved} scene${resolved.resolved === 1 ? '' : 's'}.`);
        if (resolved.failures.length) setWarnings((current) => [...current, ...resolved.failures, 'Scenes without a picture fall back to a typographic plate — the film still plays.']);
      }

      if (cancelled.current) throw new Error('This run was cancelled.');

      // 4. THE FILM. Reattach to a saved Remotion operation when possible.
      // If that operation can no longer be followed, only the composition is
      // resubmitted — the expensive narration above is always reused.
      moveStage('rendering');
      const renderId = note(session.renderOperationId ? 'Reconnecting to the existing film render\u2026' : 'Rendering the visual scenes and compositing the narrator\u2026');
      let operationId = session.renderOperationId;
      let filmUrl = '';
      if (operationId) {
        try {
          filmUrl = await pollDirectorRender(operationId, {
            isCancelled: () => cancelled.current,
            onProgress: (elapsed, status) => setLog((lines) => lines.map((line) => (line.id === renderId ? { ...line, text: `Compositing the film (${status}, ${elapsed}s)\u2026` } : line))),
          });
        } catch (resumeError) {
          if (cancelled.current) throw resumeError;
          operationId = '';
          patch({ renderOperationId: '' });
          setWarnings((current) => [...current, 'The previous composition could not be reattached, so SceneForge restarted only the Remotion composition. Your existing narration was reused.']);
        }
      }
      if (!filmUrl) {
        const job = await submitDirectorRender({ specs, avatarVideoUrl: narrationUrl, accent: session.accent });
        operationId = job.operationId;
        patch({ renderOperationId: operationId });
        filmUrl = await pollDirectorRender(operationId, {
          isCancelled: () => cancelled.current,
          onProgress: (elapsed, status) => setLog((lines) => lines.map((line) => (line.id === renderId ? { ...line, text: `Compositing the film (${status}, ${elapsed}s)\u2026` } : line))),
        });
      }
      settle(renderId, 'done', 'The film is ready.');
      patch({ filmUrl });
      moveStage('done');
    } catch (e: any) {
      const message = String(e?.message || e);
      setLog((lines) => lines.map((line) => (line.state === 'running' ? { ...line, state: 'failed', text: `${line.text} — ${message}` } : line)));
      setError(message);
      moveStage('idle', 'failed');
    }
  };

  const startOver = () => {
    clearSession();
    sessionGeneration.current += 1;
    recordId.current = null;
    setSession({ ...loadSession(), ownerKey: ownerKey.current });
    setLog([]);
    setError('');
    setWarnings([]);
    setStage('idle');
  };

  const tooLong = planned > MAX_FILM_SECONDS;

  return (
    <div className="min-h-full bg-[var(--space-surface-base)] text-[var(--space-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-base)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          {onBack ? (
            <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs font-semibold">
              <ArrowLeft className="h-3.5 w-3.5" />Avatar Studio
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-base font-bold tracking-tight"><Clapperboard className="h-4 w-4 text-[var(--space-text-brand)]" />SceneForge Director</h1>
            <p className="truncate text-[11px] text-[var(--space-text-muted)]">A narrator explains it. The visual director decides what the screen shows. Works for any subject.</p>
          </div>
          <button onClick={startOver} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs font-semibold">
            <RotateCcw className="h-3.5 w-3.5" />Start over
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {/* ---- SAVED FILMS ---- */}
        <section className={`${panel} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Your films</h2>
              <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">Reopen a visual plan, narration, or finished MP4 from this account.</p>
            </div>
            {filmsLoading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--space-text-muted)]" /> : null}
          </div>
          {syncError ? <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_8%,transparent)] p-2.5 text-xs">{syncError}</p> : null}
          {!filmsLoading && !films.length ? (
            <p className="mt-3 text-xs text-[var(--space-text-muted)]">Your first film will appear here as soon as you add a title or script.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {films.slice(0, 6).map((film) => (
                <button
                  key={film.id}
                  onClick={() => void openFilm(film.id)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${session.filmId === film.id ? 'border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_8%,transparent)]' : 'border-[var(--space-border-default)] bg-[var(--space-surface-base)] hover:border-[var(--space-border-strong)]'}`}
                >
                  <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-text-brand)]" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{film.title}</span>
                    <span className="mt-1 block text-[11px] capitalize text-[var(--space-text-muted)]">{film.status.replace(/_/g, ' ')} · {film.updatedAt ? new Date(film.updatedAt).toLocaleDateString() : 'saved'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ---- 1. SCRIPT ---- */}
        <section className={`${panel} p-5`}>
          <h2 className="text-base font-semibold">1 · The narration</h2>
          <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">Paste the script exactly as it should be spoken. Any topic — history, science, biology, finance, a documentary segment.</p>
          <label className="mt-3 block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Film title</span>
            <input
              value={session.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder={titleFor(session)}
              className="mt-1 w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-3 py-2 text-sm outline-none"
            />
          </label>
          <textarea
            value={session.script}
            onChange={(event) => patch({ script: event.target.value })}
            rows={8}
            placeholder={'Every 365 days, the Earth completes one full journey around the Sun\u2026'}
            className="mt-3 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--space-brand-primary-500)]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--space-text-muted)]">
            <span>{session.script.trim().split(/\s+/).filter(Boolean).length} words · about {estimate}s spoken</span>
            <span>{session.script.length} characters</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Direction for the visual director (optional)</span>
              <input
                value={session.notes}
                onChange={(event) => patch({ notes: event.target.value })}
                placeholder="Keep it playful; lean on timelines"
                className="mt-1 w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-3 py-2 text-sm outline-none"
              />
            </label>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Accent colour</span>
              <div className="mt-1 flex items-center gap-2">
                {ACCENTS.map((colour) => (
                  <button
                    key={colour}
                    onClick={() => patch({ accent: colour })}
                    style={{ background: colour }}
                    className={`h-8 w-8 rounded-lg transition-transform ${session.accent === colour ? 'scale-110 ring-2 ring-[var(--space-text-primary)] ring-offset-2 ring-offset-[var(--space-surface-card)]' : ''}`}
                    title={colour}
                  />
                ))}
                <select
                  value={session.imageSource}
                  onChange={(event) => patch({ imageSource: event.target.value as DirectorSession['imageSource'] })}
                  className="ml-auto rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-2.5 py-2 text-xs outline-none"
                >
                  <option value="stock">Photos: stock library</option>
                  <option value="generated">Photos: AI generated</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* ---- 2. NARRATOR ---- */}
        <NarratorPicker session={session} onPatch={patch} />

        {/* ---- 3. ANALYSE ---- */}
        <section className={`${panel} flex flex-wrap items-center justify-between gap-3 p-5`}>
          <div>
            <h2 className="text-base font-semibold">3 · Direct the visuals</h2>
            <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">The director reads the whole script and decides what the screen shows for every line.</p>
          </div>
          <div className="flex gap-2">
            {session.specs.length && !busy ? (
              <button onClick={useFallback} className="rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm font-semibold">Plain plan</button>
            ) : null}
            <button
              onClick={analyze}
              disabled={busy || session.script.trim().length < 20}
              className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            >
              {stage === 'analyzing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {stage === 'analyzing' ? 'Analysing…' : session.specs.length ? 'Re-analyse' : 'Analyse script'}
            </button>
          </div>
        </section>

        {session.specs.length ? (
          <SpecBoard specs={session.specs} accent={session.accent} onChange={(specs) => patch({ specs, filmUrl: '' })} readOnly={busy} />
        ) : null}

        {/* ---- 4/5. PREVIEW + GENERATE ---- */}
        {session.specs.length ? (
          <section className={`${panel} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">4 · Preview and build</h2>
                <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">
                  {session.narrationUrl ? 'Narration is rendered — the preview plays the real voice.' : 'This preview is the plan. The narrator joins once the narration renders.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPlaying((current) => !current); if (previewTime >= planned - 0.05) setSeek({ token: seek.token + 1, sec: 0 }); }}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm font-semibold"
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? 'Pause' : 'Play plan'}
                </button>
                <button
                  onClick={generate}
                  disabled={busy || !readyToNarrate || tooLong}
                  className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {busy ? 'Building…' : session.filmUrl ? 'Rebuild the film' : (session.narrationVideoId || session.renderOperationId) ? 'Resume build' : 'Build the film'}
                </button>
              </div>
            </div>

            {!readyToNarrate ? (
              <p className="mt-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] p-3 text-xs">
                Choose a presenter and {session.useCustomVoice ? 'upload your narration recording' : 'a voice'} in step 2 before building.
              </p>
            ) : null}
            {tooLong ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This plan is {planned.toFixed(0)}s. The render service takes up to {Math.round(MAX_FILM_SECONDS / 60)} minutes in one pass — shorten the script or split the film.
              </p>
            ) : null}

            <div className="mt-4">
              <FilmStage
                specs={session.specs}
                avatarVideoUrl={session.narrationUrl || undefined}
                accent={session.accent}
                playing={playing}
                seekToken={seek.token}
                seekSec={seek.sec}
                onTime={setPreviewTime}
                onEnded={() => setPlaying(false)}
              />
              <input
                type="range"
                min={0}
                max={Math.max(0.1, planned)}
                step={0.05}
                value={previewTime}
                onChange={(event) => { setPlaying(false); setSeek({ token: seek.token + 1, sec: Number(event.target.value) }); }}
                className="mt-3 w-full accent-[var(--space-brand-primary-600)]"
              />
              <div className="flex justify-between text-[11px] text-[var(--space-text-muted)]">
                <span>{previewTime.toFixed(1)}s</span>
                <span>{planned.toFixed(1)}s</span>
              </div>
            </div>

            {log.length ? (
              <ol className="mt-4 space-y-1.5">
                {log.map((line) => (
                  <li key={line.id} className="flex items-start gap-2 text-xs">
                    {line.state === 'running' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                      : line.state === 'done' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-success-500)]" />
                        : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-danger-500)]" />}
                    <span className={line.state === 'failed' ? 'text-[var(--space-semantic-danger-500)]' : ''}>{line.text}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            {busy ? (
              <button onClick={() => { cancelled.current = true; }} className="mt-3 rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs font-semibold">Cancel this run</button>
            ) : null}

            {error ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-3 text-xs leading-relaxed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
              </p>
            ) : null}
            {warnings.map((warning, index) => (
              <p key={index} className="mt-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] p-3 text-xs leading-relaxed text-[var(--space-text-muted)]">{warning}</p>
            ))}
          </section>
        ) : null}

        {/* ---- 6. THE FILM ---- */}
        {session.filmUrl ? (
          <section className={`${panel} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Film className="h-4 w-4 text-[var(--space-text-brand)]" />Your film</h2>
              <button
                onClick={() => downloadVideo(session.filmUrl, 'sceneforge-director.mp4')}
                className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-2.5 text-sm font-semibold text-white"
              >
                <Download className="h-4 w-4" />Download MP4
              </button>
            </div>
            <video src={session.filmUrl} controls playsInline className="mt-4 w-full rounded-xl bg-black" />
          </section>
        ) : null}

        {session.specs.length ? (
          <details className={`${panel} p-4 text-xs`} open={showSource} onToggle={(event) => setShowSource((event.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer font-semibold">The composition this plan compiles to</summary>
            <p className="mt-2 text-[var(--space-text-muted)]">Read-only. This is the exact Remotion source the render service executes — every motion is interpolate() or spring() against the frame.</p>
            {showSource ? (
              <pre className="mt-3 max-h-[380px] overflow-auto rounded-xl bg-[var(--space-surface-base)] p-3 font-mono text-[10px] leading-relaxed">{previewSource(session.specs)}</pre>
            ) : null}
          </details>
        ) : null}
      </main>
    </div>
  );
}
