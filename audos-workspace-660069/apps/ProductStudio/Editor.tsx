/**
 * Full-screen agentic Product Editor (Track B) — the dedicated editor view
 * opened from My Videos. Four zones: top bar (back · title · export ·
 * full-screen), centre video preview (subtle 3D tilt), right controls panel
 * (live-autosaving scene + video settings), bottom scene timeline (3D cards,
 * drag-to-reorder) and the agent bar (claude-sonnet-5).
 *
 * Every mutation still goes through the trackb-project server function — the
 * authoritative safe-mutation gate (ownership, validation, credits, undo/redo,
 * user-wins conflicts). Rendering stays on the untouched trackb-render /
 * orchestrator pipeline; this file only presents its outputs.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Coins, Download, Loader2, Maximize2, Menu, Minimize2, Redo2, Sparkles, Undo2, Wand2, X,
} from 'lucide-react';
import {
  trackB,
  type TrackBProjectRow, type TrackBConfig, type TrackBScene, type MutationRejection,
  type BrandKit, type ScrapedProductBrief,
} from '../../lib/trackB/api';
import BrandConfirmCard from './BrandConfirmCard';
import PlayerPreview from './PlayerPreview';
import SceneTimeline from './SceneTimeline';
import ControlsPanel from './ControlsPanel';
import AgentBar from './AgentBar';
import { Tilt } from './fx';

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

const iconBtn: React.CSSProperties = { padding: 8, borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer' };

type GenerationStage = 'capturing' | 'planning' | 'visuals' | 'composing' | 'rendering' | 'finalizing';

const GENERATION_STAGES: { id: GenerationStage; label: string; detail: string; progress: number }[] = [
  { id: 'capturing', label: 'Reading your site…', detail: 'Your page is captured, then the product brief and your brand kit (real colours, fonts, tone) are extracted from it.', progress: 10 },
  { id: 'planning', label: 'Planning & scripting…', detail: 'The scene planner designs the film structure and cinematography, then the scriptwriter writes every headline and caption on top of it.', progress: 26 },
  { id: 'visuals', label: 'Generating images…', detail: 'Scene visuals come from your screenshots or your site (AI only if you opted in). Roughly 30 seconds.', progress: 48 },
  { id: 'composing', label: 'Building compositions…', detail: 'The film\u2019s motion design is written in your brand colours and typography, then quality-checked before rendering.', progress: 66 },
  { id: 'rendering', label: 'Rendering video…', detail: 'The film renders in full 1080p with your score. Roughly 45 seconds once it starts.', progress: 84 },
  { id: 'finalizing', label: 'Done soon…', detail: 'Finalizing the player and video preview.', progress: 95 },
];

function stageFromProject(project: TrackBProjectRow, elapsedMs = 0): GenerationStage {
  const status = `${project.status || ''} ${project.project?.status || ''}`.toLowerCase();
  if (/captur|scrap/.test(status)) return 'capturing';
  const scenes = project.project?.scenes ?? [];
  if (/planning/.test(status) || scenes.length === 0) return 'planning';
  if (/planned|building/.test(status)) {
    const missingVisuals = scenes.some((s) => !(s.image_url ?? s.generated_image_url) && s.image_source !== 'brand_tile');
    return missingVisuals ? 'visuals' : 'composing';
  }
  if (/final|upload|complete/.test(status) || elapsedMs > 240000) return 'finalizing';
  return 'rendering';
}

export default function Editor({ projectId, onBack, onEnhance }: {
  projectId: number;
  onBack: () => void;
  /** Opens the Enhance Studio (auto cuts / captions / colour / export) on the READY rendered MP4. */
  onEnhance?: (target: { projectId: number; title: string; videoUrl: string; accent?: string | null }) => void;
}) {
  const [row, setRow] = useState<TrackBProjectRow | null>(null);
  const [versions, setVersions] = useState<{ id: number; version: number; scene_id: string | null; reason: string; created_at: string }[]>([]);
  const [config, setConfig] = useState<TrackBConfig | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [regenPrompt, setRegenPrompt] = useState<{ sceneId: string; cost: number; imageOnly: boolean } | null>(null);
  const [cutPrompt, setCutPrompt] = useState<{ sceneId: string; headline: string } | null>(null);
  const [composingScore, setComposingScore] = useState(false);
  const [customTrackUrl, setCustomTrackUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingShots, setUploadingShots] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage | null>(null);
  // PRD 1.1 — the captured page + extracted brand kit awaiting user review.
  const [brandConfirm, setBrandConfirm] = useState<ScrapedProductBrief | null>(null);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const generationStartedAt = useRef<number | null>(null);
  const resumedGenerationChecked = useRef(false);
  // Snapshot of finished render outputs when a generation/re-render starts, so
  // completion is detected by a NEW output landing — an old preview URL from a
  // previous render never counts as "done" for a re-render.
  const renderBaseline = useRef<{ outputs: number; hadUrl: boolean } | null>(null);

  const showNotice = useCallback((kind: 'error' | 'ok', text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    const res = await trackB.get(projectId);
    if ((res as MutationRejection).ok === false) {
      showNotice('error', (res as MutationRejection).error);
      return;
    }
    const ok = res as { project: TrackBProjectRow; versions: { id: number; version: number; scene_id: string | null; reason: string; created_at: string }[] };
    if (!ok.project) return;
    setRow(ok.project);
    setVersions(ok.versions ?? []);
    setSelectedSceneId((cur) => cur ?? ok.project.project?.scenes?.[0]?.id ?? null);
  }, [projectId, showNotice]);

  useEffect(() => {
    void refresh();
    void trackB.config().then((c) => { if (c.ok) setConfig(c); });
    const poll = window.setInterval(() => { void refresh(); }, 20000);
    return () => { window.clearInterval(poll); };
  }, [refresh]);

  // ESC exits full-screen mode.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFullscreen(false); setDrawerOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // If the editor is reopened while its first render is still running, restore
  // the progress UI from the persisted project status.
  useEffect(() => {
    if (!row || resumedGenerationChecked.current) return;
    resumedGenerationChecked.current = true;
    const status = `${row.status || ''} ${row.project?.status || ''}`.toLowerCase();
    const renderInFlight =
      !row.preview_video_url &&
      !row.player_src_url &&
      (row.project?.scenes ?? []).length > 0 &&
      /captur|plan|queue|generat|render|compos|final|upload|progress/.test(status) &&
      !/fail|error|cancel/.test(status);
    if (renderInFlight) {
      generationStartedAt.current = Date.now();
      renderBaseline.current = { outputs: (row.project?.renders ?? []).filter((r) => r.output).length, hadUrl: Boolean(row.preview_video_url || row.player_src_url) };
      setGenerationStage(stageFromProject(row));
      setGenerating(true);
      setOverlayDismissed(true); // resume unobtrusively — the top-bar pill shows progress
    }
  }, [row]);

  // Poll the pipeline while generating (presentation only — the orchestrator owns the work).
  useEffect(() => {
    if (!generating || generationStage === 'capturing' || generationStage === 'planning') return;
    let cancelled = false;

    const pollGeneration = async () => {
      try {
        try { await trackB.renderStatus(projectId); } catch { /* best-effort sync; get() below still reads state */ }
        const res = await trackB.get(projectId);
        if (cancelled) return;
        if ((res as MutationRejection).ok === false) throw new Error((res as MutationRejection).error);
        const ok = res as { project: TrackBProjectRow; versions: { id: number; version: number; scene_id: string | null; reason: string; created_at: string }[] };
        const next = ok.project;
        if (!next) return; // transient empty response — the next poll retries
        setRow(next);
        setVersions(ok.versions ?? []);

        const outputs = (next.project?.renders ?? []).filter((r) => r.output).length;
        const base = renderBaseline.current;
        const done = base
          ? outputs > base.outputs || (!base.hadUrl && Boolean(next.player_src_url || next.preview_video_url))
          : Boolean(next.player_src_url || next.preview_video_url);
        if (done) {
          setGenerationStage(null);
          setGenerating(false);
          showNotice('ok', 'Your video is ready to preview and edit.');
          return;
        }

        const status = `${next.status || ''} ${next.project?.status || ''}`.toLowerCase();
        if (/fail|error|cancel/.test(status)) {
          setGenerationStage(null);
          setGenerating(false);
          showNotice('error', 'Video generation stopped before a preview was ready. Please try again.');
          return;
        }

        const elapsed = generationStartedAt.current ? Date.now() - generationStartedAt.current : 0;
        setGenerationStage(stageFromProject(next, elapsed));
      } catch (error) {
        if (cancelled) return;
        setGenerationStage(null);
        setGenerating(false);
        showNotice('error', error instanceof Error ? error.message : 'Could not track video generation. Please try again.');
      }
    };

    void pollGeneration();
    const poll = window.setInterval(() => { void pollGeneration(); }, 4000);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [generating, generationStage, projectId, showNotice]);

  const project = row?.project ?? null;
  const scenes = project?.scenes ?? [];
  const scene = scenes.find((s) => s.id === selectedSceneId) ?? null;
  const sceneIndex = Math.max(0, scenes.findIndex((s) => s.id === selectedSceneId));
  const tiers = config?.credits?.tiers;

  const generateProject = useCallback(async () => {
    if (!row) return;
    const sourceUrl = String(row.project?.source?.url || '').trim();
    if (!sourceUrl) {
      showNotice('error', 'Add a product URL before generating so the planner has a source to capture.');
      return;
    }
    generationStartedAt.current = Date.now();
    renderBaseline.current = { outputs: (row.project?.renders ?? []).filter((r) => r.output).length, hadUrl: Boolean(row.preview_video_url || row.player_src_url) };
    setGenerating(true);
    setOverlayDismissed(false);
    setGenerationStage('capturing');
    setNotice(null);
    try {
      const capture = await trackB.scrapeWebsite(sourceUrl);
      if (!capture.success) throw new Error(capture.error || 'The product website could not be captured.');

      // PRD 1.1 — pause here: surface the extracted brand kit as a confirmation
      // card the user can review and edit BEFORE any generation runs.
      setGenerating(false);
      setGenerationStage(null);
      setBrandConfirm(capture);
    } catch (error) {
      setGenerationStage(null);
      setGenerating(false);
      showNotice('error', error instanceof Error ? error.message : 'Generation failed. Please try again.');
    }
  }, [row, showNotice]);

  /** The user confirmed (or edited) the extracted brand — run the chained planner. */
  const confirmBrandAndGenerate = useCallback(async (kit: BrandKit, keyFeatures: string[], style: string) => {
    if (!row || !brandConfirm) return;
    const capture: ScrapedProductBrief = {
      ...brandConfirm,
      brand_kit: kit,
      key_features: keyFeatures.length ? keyFeatures : brandConfirm.key_features,
      product_name: kit.product_name || brandConfirm.product_name,
      tagline: kit.tagline || brandConfirm.tagline,
    };
    setBrandConfirm(null);
    generationStartedAt.current = Date.now();
    renderBaseline.current = { outputs: (row.project?.renders ?? []).filter((r) => r.output).length, hadUrl: Boolean(row.preview_video_url || row.player_src_url) };
    setGenerating(true);
    setOverlayDismissed(false);
    setGenerationStage('planning');
    setNotice(null);
    try {
      const res = await trackB.generate(row.id, capture, style);
      if ((res as MutationRejection).ok === false) {
        const rejection = res as MutationRejection;
        throw new Error(rejection.explain ? `${rejection.error}. ${rejection.explain}` : rejection.error);
      }
      const ok = res as { project: TrackBProjectRow; message?: string };
      setRow(ok.project);
      setSelectedSceneId(ok.project?.project?.scenes?.[0]?.id ?? null);
      if (ok.project.player_src_url || ok.project.preview_video_url) {
        setGenerationStage(null);
        setGenerating(false);
        showNotice('ok', 'Your video is ready to preview and edit.');
      } else {
        // Auto-render: the planner leaves the project 'planned' with scenes but no
        // compositions yet. Immediately queue the full render pipeline here so
        // Generate always produces a finished video without a separate manual
        // Export/Render click — the orchestrator cron would eventually pick this
        // up, but this makes the render start right away.
        setGenerationStage('composing');
        try {
          const renderRes = await trackB.renderFilm(ok.project.id);
          if ((renderRes as MutationRejection).ok === false) {
            const rej = renderRes as MutationRejection;
            throw new Error(rej.explain ? `${rej.error}. ${rej.explain}` : rej.error);
          }
        } catch (renderError) {
          setGenerationStage(null);
          setGenerating(false);
          showNotice('error', renderError instanceof Error ? renderError.message : 'Your scenes are planned, but the render could not be queued automatically — click Export to render.');
        }
      }
    } catch (error) {
      setGenerationStage(null);
      setGenerating(false);
      showNotice('error', error instanceof Error ? error.message : 'Generation failed. Please try again.');
    }
  }, [row, brandConfirm, showNotice]);

  /** Export / re-render: queue the film render, watch it in the frosted overlay. */
  const exportFilm = useCallback(async () => {
    if (!row) return;
    if (scenes.length === 0) { void generateProject(); return; }
    setBusy(true);
    try {
      const res = await trackB.renderFilm(row.id);
      if ((res as MutationRejection).ok === false) {
        const rej = res as MutationRejection;
        showNotice('error', rej.explain ? `${rej.error}. ${rej.explain}` : rej.error);
      } else {
        generationStartedAt.current = Date.now();
        renderBaseline.current = { outputs: (row.project?.renders ?? []).filter((r) => r.output).length, hadUrl: Boolean(row.preview_video_url || row.player_src_url) };
        setOverlayDismissed(false);
        setGenerationStage('composing');
        setGenerating(true);
      }
    } catch {
      showNotice('error', 'The render could not be queued — please try again.');
    } finally {
      setBusy(false);
    }
  }, [row, scenes.length, generateProject, showNotice]);

  const commit = useCallback(async (operation: string, value: unknown, sceneId?: string) => {
    if (!row) return;
    setBusy(true);
    try {
      const res = await trackB.mutate(row.id, operation, value, sceneId, row.version);
      if ((res as MutationRejection).ok === false) {
        const rej = res as MutationRejection;
        showNotice('error', rej.explain ? `${rej.error}. ${rej.explain}` : rej.error);
        await refresh(); // revert inputs to the preserved server state
      } else {
        const ok = res as { applied: boolean; project?: TrackBProjectRow; cost?: number };
        if (ok.project) setRow(ok.project);
        showNotice('ok', `Saved (${ok.cost ?? 0} credit${(ok.cost ?? 0) === 1 ? '' : 's'})`);
      }
    } catch {
      showNotice('error', 'Save failed — your previous value is preserved. Retrying is safe.');
    } finally {
      setBusy(false);
    }
  }, [row, refresh, showNotice]);

  const onReorder = useCallback(async (ids: string[]) => {
    if (!row) return;
    setBusy(true);
    try {
      const res = await trackB.reorderScenes(row.id, ids);
      if ((res as MutationRejection).ok === false) {
        showNotice('error', (res as MutationRejection).error);
      } else {
        const ok = res as { applied: boolean; project?: TrackBProjectRow };
        if (ok.project) setRow(ok.project);
        if (ok.applied) showNotice('ok', 'Scenes reordered — a restorable snapshot was kept.');
      }
    } catch {
      showNotice('error', 'Reorder failed — the previous order is preserved.');
    } finally {
      setBusy(false);
    }
  }, [row, showNotice]);

  const onShotFiles = useCallback(async (files: FileList | null) => {
    if (!row || !files || !files.length) return;
    setUploadingShots(true);
    try {
      const existing = (row.user_screenshots ?? []).filter(Boolean) as string[];
      const next: string[] = [];
      for (const f of Array.from(files).slice(0, Math.max(0, 12 - existing.length))) {
        if (!f.type.startsWith('image/')) continue;
        const r = await trackB.uploadScreenshot(f);
        if (r.success && r.url) next.push(r.url);
        else showNotice('error', r.error ?? 'A screenshot could not be uploaded.');
      }
      if (next.length) {
        const res = await trackB.setImagePrefs(row.id, { userScreenshots: [...existing, ...next].slice(0, 12) });
        if ((res as MutationRejection).ok === false) showNotice('error', (res as MutationRejection).error);
        else {
          const ok = res as { project?: TrackBProjectRow };
          if (ok.project) setRow(ok.project);
          showNotice('ok', `${next.length} screenshot(s) added — they'll be used directly for the scenes.`);
        }
      }
    } finally {
      setUploadingShots(false);
    }
  }, [row, showNotice]);

  const removeShot = useCallback(async (u: string) => {
    if (!row) return;
    const res = await trackB.setImagePrefs(row.id, { userScreenshots: (row.user_screenshots ?? []).filter((x) => x !== u) });
    if ((res as MutationRejection).ok === false) showNotice('error', (res as MutationRejection).error);
    else { const ok = res as { project?: TrackBProjectRow }; if (ok.project) setRow(ok.project); }
  }, [row, showNotice]);

  const toggleAiImages = useCallback(async (on: boolean) => {
    if (!row) return;
    const res = await trackB.setImagePrefs(row.id, { aiImageEnabled: on });
    if ((res as MutationRejection).ok === false) showNotice('error', (res as MutationRejection).error);
    else {
      const ok = res as { project?: TrackBProjectRow };
      if (ok.project) setRow(ok.project);
      showNotice('ok', on ? 'AI scene images ON — used only when no screenshots exist; prompts are grounded in your product.' : 'AI scene images OFF — scenes use screenshots or brand-colour tiles.');
    }
  }, [row, showNotice]);

  const doUndoRedo = useCallback(async (kind: 'undo' | 'redo') => {
    if (!row) return;
    const res = kind === 'undo' ? await trackB.undo(row.id) : await trackB.redo(row.id);
    if (res.project) setRow(res.project);
    else if (!res.applied) showNotice('ok', `Nothing to ${kind}`);
  }, [row, showNotice]);

  const startRegen = useCallback(async (sceneId: string, imageOnly: boolean) => {
    if (!row) return;
    // Expensive operation: show the credit cost BEFORE execution.
    const res = await trackB.regenerateScene(row.id, sceneId, false);
    if ((res as MutationRejection).ok === false) {
      const rej = res as MutationRejection;
      showNotice('error', rej.explain ? `${rej.error}. ${rej.explain}` : rej.error);
      return;
    }
    const ok = res as { requires_confirmation?: boolean; cost?: number };
    setRegenPrompt({ sceneId, cost: ok.cost ?? tiers?.scene_regeneration?.default ?? 20, imageOnly });
  }, [row, showNotice, tiers]);

  const confirmRegen = useCallback(async () => {
    if (!row || !regenPrompt) return;
    setBusy(true);
    try {
      const note = regenPrompt.imageOnly
        ? '[image-only] Regenerate the scene IMAGE only — keep the approved headline, caption, duration and intent exactly as they are, and produce a fresh visual through the standard image chain.'
        : undefined;
      const res = await trackB.regenerateScene(row.id, regenPrompt.sceneId, true, note);
      if ((res as MutationRejection).ok === false) {
        const rej = res as MutationRejection;
        showNotice('error', rej.explain ? `${rej.error}. ${rej.explain}` : rej.error);
      } else {
        const ok = res as { project?: TrackBProjectRow; message?: string };
        if (ok.project) setRow(ok.project);
        showNotice('ok', ok.message ?? 'Scene regeneration queued.');
      }
    } finally {
      setBusy(false);
      setRegenPrompt(null);
    }
  }, [row, regenPrompt, showNotice]);

  const confirmCut = useCallback(async () => {
    if (!row || !cutPrompt) return;
    setBusy(true);
    try {
      const res = await trackB.cutScene(row.id, cutPrompt.sceneId, true);
      if ((res as MutationRejection).ok === false) {
        const rej = res as MutationRejection;
        showNotice('error', rej.explain ? `${rej.error}. ${rej.explain}` : rej.error);
      } else {
        const ok = res as { project?: TrackBProjectRow };
        if (ok.project) {
          setRow(ok.project);
          setSelectedSceneId(ok.project.project?.scenes?.[0]?.id ?? null);
        }
        showNotice('ok', 'Scene cut — a restorable snapshot was kept.');
      }
    } finally {
      setBusy(false);
      setCutPrompt(null);
    }
  }, [row, cutPrompt, showNotice]);

  const composeScore = useCallback(async () => {
    if (!row) return;
    setComposingScore(true);
    try {
      const projScenes = row.project?.scenes ?? [];
      const totalSeconds = Math.round(projScenes.reduce((n, s) => n + (Number(s.duration_s) || 5), 0)) + 4;
      const narrative = projScenes.map((s, i) => `${i + 1}. ${s.headline ?? ''}${s.caption ? ` — ${s.caption}` : ''}`).join(' ');
      const res = await trackB.composeCustomScore(
        `Instrumental background score for a ${totalSeconds}-second product film titled "${row.title}". Follow the emotional arc of this script scene by scene, building to an uplifting close on the call to action. No vocals. Script: ${narrative}`.slice(0, 3900),
        Math.max(15000, Math.min(120000, totalSeconds * 1000)),
      );
      if (!res.success || !res.audioUrl) throw new Error(res.error || 'The score could not be composed.');
      const added = await trackB.addMusicTrack(row.id, { label: 'My composed score', url: res.audioUrl, script_matched: true });
      if ((added as MutationRejection).ok === false) throw new Error((added as MutationRejection).error);
      const okAdd = added as { track_id?: string; project?: TrackBProjectRow };
      if (okAdd.project) setRow(okAdd.project);
      if (okAdd.track_id) await commit('set_music_track', okAdd.track_id);
      showNotice('ok', 'Score composed from your script and selected — the next render bakes it in.');
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'The score could not be composed.');
    } finally {
      setComposingScore(false);
    }
  }, [row, commit, showNotice]);

  const addCustomTrack = useCallback(async () => {
    if (!row) return;
    const url = customTrackUrl.trim();
    if (!/^https:\/\//i.test(url)) { showNotice('error', 'Paste an https audio URL (e.g. an .mp3).'); return; }
    const added = await trackB.addMusicTrack(row.id, { label: 'Custom track', url });
    if ((added as MutationRejection).ok === false) { showNotice('error', (added as MutationRejection).error); return; }
    const ok = added as { track_id?: string; project?: TrackBProjectRow };
    if (ok.project) setRow(ok.project);
    setCustomTrackUrl('');
    if (ok.track_id) await commit('set_music_track', ok.track_id);
    showNotice('ok', 'Track added to this project and selected.');
  }, [row, customTrackUrl, commit, showNotice]);

  const onRestoreVersion = useCallback((versionId: number, version: number) => {
    if (!row) return;
    void trackB.restoreVersion(row.id, versionId).then((r) => {
      if ((r as MutationRejection).ok === false) showNotice('error', (r as MutationRejection).error);
      else { void refresh(); showNotice('ok', `Restored v${version}`); }
    });
  }, [row, refresh, showNotice]);

  if (!row || !project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 320, color: S.muted, fontSize: 14 }}>
        <Loader2 size={16} className="rc-spin" /> Loading project…
      </div>
    );
  }

  const pendingRerender = row.last_render_version != null ? row.version > row.last_render_version : row.version > 1 && row.status !== 'draft';
  const tokens = project.brand?.tokens ?? {};
  const stageIndex = generationStage ? Math.max(0, GENERATION_STAGES.findIndex((i) => i.id === generationStage)) : 0;
  const stage = GENERATION_STAGES[stageIndex];
  const elapsedS = generationStartedAt.current ? Math.round((Date.now() - generationStartedAt.current) / 1000) : 0;

  const controls = (
    <ControlsPanel
      row={row}
      config={config}
      scene={scene}
      sceneIndex={sceneIndex}
      sceneCount={scenes.length}
      busy={busy}
      versions={versions}
      onCommit={(op, v, sid) => { void commit(op, v, sid); }}
      onRegenScene={(sid, imageOnly) => { void startRegen(sid, imageOnly); }}
      onRestoreVersion={onRestoreVersion}
      uploadingShots={uploadingShots}
      onUploadShots={(files) => { void onShotFiles(files); }}
      onRemoveShot={(u) => { void removeShot(u); }}
      onToggleAi={(on) => { void toggleAiImages(on); }}
      composingScore={composingScore}
      onComposeScore={() => { void composeScore(); }}
      customTrackUrl={customTrackUrl}
      onCustomTrackUrlChange={setCustomTrackUrl}
      onAddCustomTrack={() => { void addCustomTrack(); }}
    />
  );

  return (
    <div
      style={fullscreen
        ? { position: 'fixed', inset: 0, zIndex: 70, display: 'flex', flexDirection: 'column', gap: 10, padding: 'clamp(10px, 2vw, 18px)', boxSizing: 'border-box', background: 'var(--space-surface-bg)', color: S.text, overflowY: 'auto' }
        : { display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%', boxSizing: 'border-box', padding: 'clamp(12px, 2.5vw, 22px)', color: S.text }}
      data-testid="product-editor"
    >
      {/* ---- zone 1: top bar ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!fullscreen ? (
          <button type="button" onClick={onBack} aria-label="Back to My Videos" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, flexShrink: 0 }} data-testid="button-back">
            <ArrowLeft size={13} /> My Videos
          </button>
        ) : null}
        <div style={{ flex: 1, minWidth: 140 }}>
          <input
            key={`title-${row.version}`}
            defaultValue={project.title}
            maxLength={140}
            aria-label="Project name"
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== project.title) void commit('set_title', v); }}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10, fontWeight: 800, fontSize: 15, background: 'transparent', border: '1px solid transparent', color: S.text, outline: 'none' }}
            data-testid="input-title"
          />
        </div>
        {generating && overlayDismissed && generationStage ? (
          <button type="button" onClick={() => setOverlayDismissed(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, border: '1px solid var(--space-brand-primary-200)', background: 'var(--space-brand-primary-50)', color: S.brand, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }} data-testid="pill-render-progress">
            <Loader2 size={11} className="rc-spin" /> {stage.label}
          </button>
        ) : null}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: S.brand }} title="Credits spent on this project">
          <Coins size={13} /> {row.credits_spent}
        </span>
        <button type="button" onClick={() => void doUndoRedo('undo')} disabled={busy || (row.undo_stack ?? []).length === 0} aria-label="Undo" title="Undo (free)" style={{ ...iconBtn, color: (row.undo_stack ?? []).length ? S.sub : S.muted }} data-testid="button-undo"><Undo2 size={14} /></button>
        <button type="button" onClick={() => void doUndoRedo('redo')} disabled={busy || (row.redo_stack ?? []).length === 0} aria-label="Redo" title="Redo (free)" style={{ ...iconBtn, color: (row.redo_stack ?? []).length ? S.sub : S.muted }} data-testid="button-redo"><Redo2 size={14} /></button>
        {row.preview_video_url && onEnhance ? (
          <button
            type="button"
            onClick={() => onEnhance({ projectId: row.id, title: project.title, videoUrl: row.preview_video_url as string, accent: (project.brand?.tokens as { primary?: string } | undefined)?.primary ?? null })}
            title="Auto cuts, captions, trim, colour and export - on the finished video"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 10, border: '1px solid var(--space-brand-primary-500)', background: 'transparent', color: S.brand, cursor: 'pointer' }}
            data-testid="button-open-enhance"
          >
            <Wand2 size={13} />
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, lineHeight: 1.2 }}>Enhance</span>
              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, opacity: 0.8, lineHeight: 1.2 }}>Add graphics & captions</span>
            </span>
          </button>
        ) : null}
        {row.preview_video_url ? (
          <a href={row.preview_video_url} download target="_blank" rel="noreferrer" aria-label="Download the rendered MP4" title="Download the rendered MP4" style={{ ...iconBtn, display: 'inline-flex', textDecoration: 'none' }} data-testid="button-download"><Download size={14} /></a>
        ) : null}
        <button
          type="button"
          onClick={() => void exportFilm()}
          disabled={busy || generating}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', opacity: busy || generating ? 0.6 : 1 }}
          data-testid="button-export"
        >
          <Sparkles size={13} />
          <span style={{ textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, lineHeight: 1.2 }}>{scenes.length === 0 ? 'Generate' : pendingRerender ? 'Export · re-render' : 'Export'}</span>
            <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, opacity: 0.85, lineHeight: 1.2 }}>{scenes.length === 0 ? 'Build your first cut' : pendingRerender ? 'Render your latest edits' : 'Download finished video'}</span>
          </span>
        </button>
        <button type="button" onClick={() => { setFullscreen(!fullscreen); setDrawerOpen(false); }} aria-label={fullscreen ? 'Exit full-screen (Esc)' : 'Full-screen editor'} title={fullscreen ? 'Exit full-screen (Esc)' : 'Full-screen editor'} style={iconBtn} data-testid="button-fullscreen">
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {fullscreen ? (
          <button type="button" onClick={() => setDrawerOpen(!drawerOpen)} aria-label="Toggle controls panel" title="Controls" style={{ ...iconBtn, borderColor: drawerOpen ? S.borderStrong : S.border, background: drawerOpen ? S.panelStrong : S.card }} data-testid="button-drawer">
            <Menu size={14} />
          </button>
        ) : null}
      </div>

      {notice ? (
        <div role="status" style={{ padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: notice.kind === 'error' ? S.danger : S.success, background: `color-mix(in srgb, ${notice.kind === 'error' ? S.danger : S.success} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${notice.kind === 'error' ? S.danger : S.success} 30%, transparent)` }} data-testid="editor-notice">
          {notice.text}
        </div>
      ) : null}

      {/* ---- zone 2: preview (centre) + controls (right) ---- */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ flex: '1 1 460px', minWidth: 'min(100%, 320px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Tilt maxTilt={1.6} hoverLift={false} style={{ borderRadius: 14 }}>
            <PlayerPreview
              playerSrcUrl={row.player_src_url}
              previewVideoUrl={row.preview_video_url}
              pendingRerender={pendingRerender}
              rendering={generating}
              onRerender={() => void exportFilm()}
              status={row.status}
              scenes={scenes}
              brandTokens={tokens}
              selectedSceneId={selectedSceneId}
              onSelectScene={setSelectedSceneId}
            />
          </Tilt>

          {scenes.length === 0 && !generating ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 12, border: `1px solid ${S.border}`, background: S.panel }} data-testid="generation-controls">
              <div style={{ minWidth: 180, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: S.text }}>Ready to build your first cut?</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: S.muted }}>Generate captures the product URL first, then plans the editable scenes. Screenshot / AI-image preferences live in Video settings on the right.</p>
              </div>
              <button type="button" onClick={() => void generateProject()} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 128, padding: '9px 14px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }} data-testid="button-generate">
                <Sparkles size={14} /> Generate
              </button>
            </div>
          ) : null}
        </div>

        {!fullscreen ? (
          <div style={{ flex: '0 1 340px', minWidth: 'min(100%, 300px)', maxWidth: 420 }}>{controls}</div>
        ) : null}
      </div>

      {/* ---- zone 3: scene timeline ---- */}
      <div style={{ borderRadius: 14, border: `1px solid ${S.border}`, background: S.panel, padding: '4px 8px' }}>
        {scenes.length > 0 ? (
          <p style={{ margin: '6px 4px 0', fontSize: 11, fontWeight: 700, color: S.muted }} data-testid="timeline-total">
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {Math.round(scenes.reduce((n, s) => n + (Number(s.duration_s) || 0), 0) * 10) / 10}s planned
          </p>
        ) : null}
        <SceneTimeline
          scenes={scenes}
          selectedSceneId={selectedSceneId}
          onSelect={setSelectedSceneId}
          onReorder={(ids) => { void onReorder(ids); }}
          onCut={(s: TrackBScene) => setCutPrompt({ sceneId: s.id, headline: s.headline ?? s.id })}
          brandTokens={tokens}
          busy={busy || generating}
        />
      </div>

      {/* ---- zone 4: agent bar ---- */}
      <AgentBar row={row} disabled={busy} onRefresh={refresh} />

      {/* full-screen slide-out controls drawer */}
      {fullscreen && drawerOpen ? (
        <div className="ps-frost" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(380px, 92vw)', zIndex: 80, borderLeft: `1px solid ${S.borderStrong}`, padding: 14, overflowY: 'auto', boxSizing: 'border-box' }} data-testid="fullscreen-drawer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>Controls</h3>
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close controls" style={{ ...iconBtn, padding: 6 }}><X size={13} /></button>
          </div>
          {controls}
        </div>
      ) : null}

      {/* frosted-glass rendering overlay — dismissible, never blocks editing */}
      {generating && generationStage && !overlayDismissed ? (
        <div className="ps-frost" role="status" aria-live="polite" style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }} data-testid="render-overlay">
          <div className="ps-fade-up" style={{ width: 'min(520px, 94vw)', borderRadius: 18, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 'clamp(18px, 4vw, 28px)', boxShadow: '0 30px 80px rgba(2,6,18,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 size={20} className="rc-spin" color="var(--space-text-brand)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: S.text }}>{stage.label}</p>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: S.brand }}>Step {stageIndex + 1} of {GENERATION_STAGES.length}</span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: S.muted, lineHeight: 1.5 }}>{stage.detail}</p>
              </div>
            </div>
            <div style={{ height: 8, marginTop: 14, overflow: 'hidden', borderRadius: 999, background: S.card, border: `1px solid ${S.border}` }}>
              <div style={{ width: `${stage.progress}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--space-brand-primary-600), var(--space-brand-highlight-500))', transition: 'width 500ms ease' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 10 }} aria-hidden="true">
              {GENERATION_STAGES.map((item, index) => (
                <span key={item.id} style={{ fontSize: 10.5, color: index <= stageIndex ? S.brand : S.muted, fontWeight: index === stageIndex ? 800 : 600, whiteSpace: 'nowrap' }}>
                  {index < stageIndex ? '✓ ' : ''}{item.label.replace('…', '')}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: S.muted }}>Elapsed {elapsedS}s · images ~30s · render ~45s once queued</span>
              <button type="button" onClick={() => setOverlayDismissed(true)} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }} data-testid="button-run-background">
                Run in background — keep editing
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* brand confirmation card (PRD 1.1) — review/edit the extracted brand BEFORE generation */}
      {brandConfirm ? (
        <BrandConfirmCard
          capture={brandConfirm}
          busy={busy || generating}
          onConfirm={(kit, feats, style) => { void confirmBrandAndGenerate(kit, feats, style); }}
          onCancel={() => { setBrandConfirm(null); showNotice('ok', 'Generation paused — your capture is kept. Hit Generate when you are ready.'); }}
        />
      ) : null}

      {/* cut confirmation — quick cut with a restorable snapshot */}
      {cutPrompt ? (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,8,18,0.66)' }}>
          <div className="ps-fade-up" style={{ width: 'min(400px, 92vw)', borderRadius: 16, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 20 }} data-testid="dialog-cut">
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: S.text }}>Cut this scene?</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: S.sub, lineHeight: 1.6 }}>
              “{cutPrompt.headline}” is removed from the film and the remaining scenes close the gap. A restorable snapshot is kept in Versions.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setCutPrompt(null)} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} data-testid="button-cut-cancel">Keep it</button>
              <button type="button" onClick={() => void confirmCut()} disabled={busy} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }} data-testid="button-cut-confirm">
                {busy ? 'Cutting…' : 'Cut scene'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* regeneration confirmation — cost shown BEFORE execution */}
      {regenPrompt ? (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,8,18,0.66)' }}>
          <div className="ps-fade-up" style={{ width: 'min(400px, 92vw)', borderRadius: 16, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 20 }} data-testid="dialog-regen">
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: S.text }}>{regenPrompt.imageOnly ? `Re-generate the image for ${regenPrompt.sceneId}?` : `Regenerate ${regenPrompt.sceneId}?`}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: S.sub, lineHeight: 1.6 }}>
              {regenPrompt.imageOnly
                ? <>A fresh visual is produced through the standard image chain while your headline, caption and timing stay exactly as they are. Costs <strong style={{ color: S.brand }}>{regenPrompt.cost} credits</strong>; nothing is charged if it fails.</>
                : <>This costs <strong style={{ color: S.brand }}>{regenPrompt.cost} credits</strong>, touches only this scene, and keeps a restorable snapshot of the current version. If it fails, nothing is charged and the current scene stays.</>}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setRegenPrompt(null)} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} data-testid="button-regen-cancel">Cancel</button>
              <button type="button" onClick={() => void confirmRegen()} disabled={busy} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }} data-testid="button-regen-confirm">
                {busy ? 'Queueing…' : `Confirm · ${regenPrompt.cost} credits`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
