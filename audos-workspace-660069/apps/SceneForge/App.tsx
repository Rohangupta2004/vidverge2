import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clapperboard, Film, FolderOpen, ImagePlus, Loader2, MessageSquareText, Plus, RefreshCw, Send, Settings, X } from 'lucide-react';
import TopicInput from './components/TopicInput';
import ScriptReview from './components/ScriptReview';
import HeyGenModule from './components/HeyGenModule';
import StylePicker from './components/StylePicker';
import EditorHandoff from './components/EditorHandoff';
import SettingsPanel from './components/SettingsPanel';
import AssetStudio from './components/AssetStudio';
import { useProject } from './hooks/useProject';
import { useScenes } from './hooks/useScenes';
import { isExpiredHeyGenSignedUrl, isTerminalRenderFailure, useHeyGen } from './hooks/useHeyGen';
// ONE LLM. Every language-model call in this pipeline goes through the single
// orchestrator (script, scene manifest, image/video prompts, overlay specs,
// change-request routing); imageTool and videoTool are LLM-free executors of
// the prompts that orchestrator wrote.
import { planScenes, routeChangeRequest, writeScript } from './agents/orchestrator';
import { ensureMotionBackground, ensureSceneImage, generateSceneImage } from './lib/imageTool';
import { generateSceneVideo, sceneVideoPrompt, setSceneVideoEngine } from './lib/videoTool';
import { generatePortraitCalloutImage, generatePortraitImageCardPng, generatePortraitMotionOverlayFrames, generateSceneMotionClip, sceneMotionSpec } from './lib/motionCapture';
// Directed production: Opus Motion Director → GSAP capture → visual QA with
// auto-fix (see lib/motionPipeline). One call per motion scene.
import { produceMotionScene } from './lib/motionPipeline';
import { findReusableAsset } from './lib/assetReuse';
import { isMotionFingerprint, specFromOverlay } from './lib/motionSpec';
import { getStyle } from './styles/registry';
import { buildTimeline, createAssemblySource, timelineDurationInFrames } from './remotion/AssemblyComp';
import { captionChunks, musicBedProps } from './remotion/compositionRuntime';
import { runChecks } from './lib/checks';
import { filmQaChecks, runFilmQa, verifyRenderOutput } from './lib/filmQa';
import { validateTimeline } from './lib/timelineValidation';
import { newGenerationId, planOf, treatmentOfScene, type DirectorPlan } from './lib/directorPlan';
import { saveUpload } from './lib/storage';
import { DEFAULT_SETTINGS, WORKSPACE_ID, assemblyJobRunning, getProject, listAssets, listScenes, loadSettings, updateProject, updateScene, type Asset, type AssemblyJob, type ForgeSettings, type Project, type Scene } from './lib/supabase';
import { defaultOverlay, visualKindOf, type VisualKind } from './lib/effects';
import { isVideoUrl, sceneKind, sceneNeedsGeneration, sceneSettled } from './lib/sceneState';
import { forgeApi } from './lib/forge';
import { sleep, uploadFile, workspaceToken } from './lib/proxy';
import { AgentChatProvider } from '../../components/AgentChat/AgentChatContext';
import { AgentChatButton } from '../../components/AgentChat/AgentChatButton';
import { AgentChatPanel } from '../../components/AgentChat/AgentChatPanel';
import { videoEngine } from '../../lib/videoEngines';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import { integrationForEngineId, type VideoIntegrationId } from '../../lib/videoIntegrations';
import type { VidvergeAttachment } from '../../lib/vidvergeHandoff';
import { VIDVERGE_HANDOFF_KEY } from '../../lib/vidvergeHandoff';
import AvatarStudio from './components/AvatarStudio';
import HeyGenConsole from './components/heygen/HeyGenConsole';
import MotionEditor, { type MotionEditorSource } from './components/MotionEditor';
import { fetchVideoStatus } from './lib/heygenStudio';
// THE STUDIO WORKBENCH is SceneForge's working surface once a project has
// scenes: one screen with the provider selector, the preview, the scene
// timeline and a single collapsible panel. The step wizard below it is kept
// only for first-run (topic -> script -> presenter -> style).
import StudioWorkbench, { type SceneProgress } from './components/StudioWorkbench';
import { DEFAULT_SCENE_PROVIDER, describeProviderFailure, estimateGeneration, estimateSecondsPerClip, probeProviders, type ProviderStatus } from './lib/providers';
import { DEFAULT_STUDIO_CONFIG, applyAutoGraphics, postProductionProps, saveStudioConfig, studioConfigOf, type StudioConfig } from './lib/studioConfig';
import { runSceneVision } from './lib/sceneVision';
import { setSceneBroll, type BrollClip } from './lib/broll';
import { fetchElevenVoices, type ElevenVoice } from './lib/elevenLabs';
import { lipsyncScenes, narrateScenes, sceneSpeechWindows, scenesNeedingLipsync, scenesNeedingVoice, stampTimelineAudio } from './lib/sceneAudio';

type View = 'library' | 'project' | 'settings';

// SceneForge has two faces. 'studio' is the HeyGen Avatar Studio — pick an
// avatar, pick a voice, write a script, render and download one MP4 — and it
// is what the app opens on. 'pipeline' is the full directed explainer
// production (research script → avatar master → scene blueprint → assembly),
// one click away and otherwise untouched.
// 'suite' is the full HeyGen suite (components/heygen): one locked character
// and brand carried across brief, storyboard, motion graphics and every
// post-production pass. 'studio' stays the fast single-script render.
type Surface = 'studio' | 'pipeline' | 'suite';
const SURFACE_KEY = 'sceneforge_surface_v1';

function friendlyErrorText(value: unknown): string {
  const raw = String(value || 'This step could not be completed.');
  const named = raw.replace(/(?:openrouter\/[^\s,;]+|gemini-omni-flash-preview|veo-[\w.-]+)/g, (id) => videoEngine(id)?.label || 'the selected video engine');
  if (/no_credentials|\b401\b/i.test(named)) return 'Your workspace session is not ready yet. Try again in a moment.';
  if (/insufficient|payment|required|\b402\b/i.test(named)) return 'This generation needs more workspace credits before it can start.';
  if (/rate.?limit|\b429\b/i.test(named)) return 'The production service is busy right now. Wait a moment, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(named)) return 'A production service is temporarily unavailable. Your completed work is safe; retry this step shortly.';
  return named;
}

function pipelineLog(stage: 'script-llm' | 'assets' | 'scene-media' | 'joiner', event: string, details: Record<string, unknown> = {}) {
  console.info(`[SceneForge pipeline] ${stage}:${event}`, details);
}

// One broken overlay clip fails the WHOLE portrait composite: ffmpeg exits
// with code 234 (EINVAL) when an overlay input carries no readable video
// stream, and the signature of such a file is a header-only browser capture
// of about 1 KB. Nothing under this floor can be a real clip.
const BROKEN_CLIP_MAX_BYTES = 24_000;

// Measure a remote asset's true byte size without downloading it. A
// measurement that cannot be made (CORS, network) returns null and the asset
// is treated as healthy — the check must never block an assembly by itself.
async function overlayAssetBytes(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const contentRange = response.headers.get('content-range');
    const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
    if (Number.isFinite(total) && total > 0) return total;
    const length = Number(response.headers.get('content-length'));
    return response.status === 200 && Number.isFinite(length) ? length : null;
  } catch { return null; }
}

// Why a render died is written into the project's stage note as well as the
// banner: the banner is gone after a reload, and Step 7 has to keep being able
// to explain itself and offer the retry.
const ASSEMBLY_FAILED_PREFIX = 'Assembly failed:';

// Error marker for a customer-cancelled assembly: the run settles as
// 'cancelled' (nothing broke) instead of 'failed'.
const ASSEMBLY_CANCELLED = 'assembly-cancelled';

// A running assembly job whose heartbeat is older than this was orphaned by a
// closed or refreshed tab — no browser session is driving it any more.
const ASSEMBLY_HEARTBEAT_STALE_MS = 45_000;

// Once a project has a scene plan, the Studio workbench IS the surface: one
// screen with the provider selector, the preview, the scene timeline and a
// single collapsible panel. The step wizard that precedes it only covers
// first-run (topic -> script -> presenter -> style).
const WORKBENCH_STATUSES = ['scene_review', 'asset_gen', 'coding', 'assembling', 'checks', 'done'];

function ForgePipeline({ onExitToStudio }: { onExitToStudio: () => void }) {
  const projectState = useProject();
  const { project, setProject, projects, loading, error, setError, start, patch, open, refreshLibrary } = projectState;
  const sceneState = useScenes(project?.id);
  const { scenes, setScenes, replaceFromPlan, patchScene, remove, add } = sceneState;
  const heygen = useHeyGen();
  const [view, setView] = useState<View>('library');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [settings, setSettings] = useState<ForgeSettings>(DEFAULT_SETTINGS);
  const [sceneShare, setSceneShare] = useState<'low' | 'medium' | 'high'>('medium');
  const [vergerOpen, setVergerOpen] = useState(false);
  const [assetStudioOpen, setAssetStudioOpen] = useState(false);
  const [vergerText, setVergerText] = useState('');
  const [vergerMessages, setVergerMessages] = useState<{ role: 'user' | 'verger'; text: string }[]>([]);
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const [sceneImageError, setSceneImageError] = useState('');
  const [imageBriefs, setImageBriefs] = useState<{ scene: number; brief: string }[]>([]);
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicNote, setMusicNote] = useState('');
  const [initialTopic, setInitialTopic] = useState('');
  const [initialAttachment, setInitialAttachment] = useState<VidvergeAttachment | null>(null);
  // ---- Studio workbench state ----------------------------------------
  // The workbench's own settings live on the project row (studio_config) so
  // the script draft, brand accent, cards and provider choice survive a
  // reload; `studio` is the live copy and is auto-saved behind a debounce.
  const [studio, setStudio] = useState<StudioConfig>(DEFAULT_STUDIO_CONFIG);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [sceneProgress, setSceneProgress] = useState<SceneProgress>({ active: false, done: 0, total: 0, currentIndex: null, etaSec: 0, message: '' });
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [analyzingSceneId, setAnalyzingSceneId] = useState<string | null>(null);
  const [autoGraphicsBusy, setAutoGraphicsBusy] = useState(false);
  const [autoGraphicsNote, setAutoGraphicsNote] = useState('');
  const [characterNote, setCharacterNote] = useState('');
  // ---- Per-scene speech (the Audio tab) --------------------------------
  // The mode, voice and every clip live in studio_config.audio and ride the
  // same debounced save as the rest of the workbench; this is only the live
  // catalog and the run state.
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[]>([]);
  const [elevenVoicesLoading, setElevenVoicesLoading] = useState(true);
  const [elevenVoicesError, setElevenVoicesError] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioNote, setAudioNote] = useState('');
  const studioSaveTimer = useRef(0);
  const studioLoadedFor = useRef('');
  // Guards assembly specifically. `busy` is shared with every other stage —
  // the Verger panel raises it before routing a request into assembly — so it
  // cannot tell a second Assemble click from a legitimate hand-off.
  const assembling = useRef(false);
  // Raised by Step 7's Cancel button: the poll loops stop, the portrait
  // FFmpeg fetch is aborted, and the run settles as 'cancelled', not 'failed'.
  const assemblyCancelled = useRef(false);
  const assemblyAbort = useRef<AbortController | null>(null);
  // Throttles the persisted assembly-job heartbeat so a long render does not
  // write the project row on every 2-second progress tick.
  const assemblyJobPersistedAt = useRef(0);
  // Raised by the Cancel button on the production board: the generation lanes
  // stop pulling new scenes, clips already in flight finish and are KEPT, and
  // nothing navigates or resets. Cleared at the start of every batch run.
  const cancelBatch = useRef(false);
  // A run that died inside a Claude call leaves its scene parked on
  // coding_status 'coding' with nobody left to finish it. Reopening the
  // project hands those scenes back to 'pending' once, so the board stops
  // spinning on work that is never coming.
  const stuckCodingReset = useRef('');
  // Reload-resume guards: each in-flight render is reattached at most once
  // per project, so a rerender cannot stack a second poll on the first.
  const resumedAvatar = useRef('');
  const resumedRender = useRef('');
  // A portrait assembly has no server operation to reattach to; its orphan
  // check runs at most once per project.
  const resumedPortrait = useRef('');
  // A project reopened on 'scene_planning' has no planner running — the
  // planning LLM call lives only in the browser session that started it — so
  // it is handed back to style_choice at most once per project.
  const resumedPlanning = useRef('');
  // HeyGen's CloudFront URLs expire in hours. One in-flight refresh is shared
  // by project loading, player recovery and assembly preflight so simultaneous
  // failures never stampede the provider or race different URLs into state.
  const [refreshingVideoLink, setRefreshingVideoLink] = useState(false);
  const videoUrlRefresh = useRef<Promise<string> | null>(null);
  const expiredUrlRefreshAttempted = useRef('');
  const refreshAvatarVideoUrl = useCallback(async (target: Project): Promise<string> => {
    if (!target.id || !target.heygen_video_id) throw new Error('This project has no HeyGen render id to refresh.');
    if (videoUrlRefresh.current) return videoUrlRefresh.current;
    setRefreshingVideoLink(true);
    const pending = heygen.refreshVideoUrl(target.id).then((refreshed) => {
      setProject((live) => live && live.id === target.id ? {
        ...live,
        heygen_video_url: refreshed.videoUrl,
        heygen_chunks: refreshed.heygenChunks.length ? refreshed.heygenChunks : live.heygen_chunks,
      } : live);
      return refreshed.videoUrl;
    });
    videoUrlRefresh.current = pending;
    try { return await pending; }
    finally {
      if (videoUrlRefresh.current === pending) videoUrlRefresh.current = null;
      setRefreshingVideoLink(false);
    }
  }, [heygen.refreshVideoUrl, setProject]);

  useEffect(() => {
    const handoff = consumeVidvergeHandoff('sceneforge');
    if (!handoff) return;
    if (handoff.projectId != null) {
      setView('project');
      void open(String(handoff.projectId));
      return;
    }
    setInitialTopic(String(handoff.prompt || ''));
    setInitialAttachment(handoff.attachment || null);
    if (handoff.videoModel) {
      setSceneVideoEngine(handoff.videoModel);
      const integration = (handoff.videoIntegration || integrationForEngineId(handoff.videoModel)) as VideoIntegrationId;
      setStudio((prev) => ({
        ...prev,
        video_integration: integration,
        provider: handoff.videoModel || prev.provider,
      }));
    }
    setProject(null);
    setView('project');
  }, []);

  useEffect(() => { loadSettings().then((value) => { setSettings(value); setSceneShare(value.default_scene_share); }).catch(() => undefined); }, []);
  // The motion engine's theme source for preview surfaces that don't carry
  // the project object: 'vox-explainer' renders the paper-cut visual language
  // (lib/motionKit), every other style keeps the midnight look.
  useEffect(() => { (window as any).__sceneForgeStyleId = project?.style || ''; }, [project?.style]);
  useEffect(() => {
    if (!project?.id || project.status !== 'scene_review') return;
    let cancelled = false;
    listAssets(project.id).then((assets) => {
      if (cancelled) return;
      setProjectAssets(assets);
      const imageByScene = new Map<string, string>();
      assets.forEach((asset) => { if (asset.scene_id && asset.public_url) imageByScene.set(asset.scene_id, asset.public_url); });
      setScenes((all) => all.map((scene) => scene.render_url || !imageByScene.has(scene.id) ? scene : { ...scene, render_url: imageByScene.get(scene.id) }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [project?.id, project?.status, setScenes]);

  // LIVE PROGRESS. While assets, code or assembly are running, the app asks
  // the server function for the current state every four seconds and repaints
  // from its answer, so a card turns over the moment its OWN image or code
  // lands instead of when the whole batch finishes. WorkspaceDB has no
  // realtime channel for these tables; this is the equivalent, and it also
  // means a reload mid-run picks the run back up instead of losing it.
  useEffect(() => {
    const id = project?.id;
    // 'checks' is deliberately absent: it is where both a finished and a
    // failed assembly come to rest, and polling it changes nothing.
    const live = Boolean(project && ['asset_gen', 'coding', 'assembling'].includes(project.status));
    if (!id || !live) return;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const status = await forgeApi.status(id);
        if (stopped) return;
        setScenes([...status.scenes].sort((a, b) => a.scene_index - b.scene_index));
        setProject((current) => {
          if (!current || current.id !== id) return current;
          const merged = { ...current, ...status.project };
          // While THIS tab drives the assembly, its local job state runs ahead
          // of the persisted row — a lagging poll must not rewind the bar.
          if (assembling.current && current.assembly_job) merged.assembly_job = current.assembly_job;
          return merged;
        });
        // Nothing left to watch once every scene has both halves and the board
        // is just waiting on the customer to press Assemble.
        const settled = (status.progress.assemble_ready && (status.project.status === 'asset_gen' || status.project.status === 'coding')) || (status.project.status === 'done' && Boolean(status.project.assembled_video_url));
        if (settled) { stopped = true; window.clearInterval(timer); }
      } catch { /* a dropped poll is simply repainted by the next one */ }
    };
    void tick();
    timer = window.setInterval(() => void tick(), 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [project?.id, project?.status, setScenes, setProject]);

  // Runs when the coding step is on screen and nothing is actively writing
  // code, so a customer who reloads onto a half-finished run sees the stalled
  // scenes as waiting and can restart them instead of watching a dead spinner.
  useEffect(() => {
    const id = project?.id;
    if (!id || project?.status !== 'coding' || busy || stuckCodingReset.current === id) return;
    const stalled = scenes.filter((scene) => scene.coding_status === 'coding' && !scene.remotion_code);
    if (!stalled.length) return;
    stuckCodingReset.current = id;
    void (async () => {
      for (const scene of stalled) await updateScene(scene.id, { coding_status: 'pending' }, id).catch(() => undefined);
      setScenes((all) => all.map((item) => stalled.some((row) => row.id === item.id) ? { ...item, coding_status: 'pending' } : item));
      pipelineLog('scene-media', 'stalled-scenes-reopened', { projectId: id, sceneCount: stalled.length });
    })();
  }, [project?.id, project?.status, scenes, busy, setScenes]);

  // Refresh a persisted signed URL as soon as an expired project is opened.
  // The old URL never reaches an assembly or sits behind a MissingKey player.
  useEffect(() => {
    const current = project;
    if (!current?.id || !current.heygen_video_id || !current.heygen_video_url || !isExpiredHeyGenSignedUrl(current.heygen_video_url)) return;
    const key = `${current.id}:${current.heygen_video_url}`;
    if (expiredUrlRefreshAttempted.current === key) return;
    expiredUrlRefreshAttempted.current = key;
    void refreshAvatarVideoUrl(current).catch((e: any) => setError(String(e?.message || e)));
  }, [project?.id, project?.heygen_video_id, project?.heygen_video_url, refreshAvatarVideoUrl, setError]);

  // Reload-recovery for the avatar stage: a HeyGen render whose id was
  // persisted at submit is picked back up here, so closing the tab no longer
  // loses a paid render.
  useEffect(() => {
    const current = project;
    if (!current?.id || current.status !== 'avatar_render' || !current.heygen_video_id || current.heygen_video_url || busy || resumedAvatar.current === current.id) return;
    resumedAvatar.current = current.id;
    void (async () => {
      setBusy(true); setError('');
      try {
        const result = await heygen.resume(current);
        const next: Partial<Project> = { heygen_video_url: result.videoUrl, avatar_duration_sec: result.duration, word_timestamps: result.words, status: 'style_choice', heygen_chunks: [{ video_id: result.videoId, video_url: result.videoUrl, duration_sec: result.duration }] };
        await updateProject(current.id, next);
        setProject((live) => live && live.id === current.id ? { ...live, ...next } : live);
        pipelineLog('assets', 'audio-video-resumed', { projectId: current.id, videoId: result.videoId, durationSec: result.duration });
      } catch (e: any) {
        setError(e.message || String(e));
        // HeyGen already declared this render dead — clear the stored id so
        // the next open offers a clean retry instead of auto-resuming (and
        // re-erroring on) the same failed render, and park the reason where
        // it survives the session.
        if (isTerminalRenderFailure(e)) {
          await updateProject(current.id, { heygen_video_id: null }).catch(() => undefined);
          setProject((live) => live && live.id === current.id ? { ...live, heygen_video_id: null } : live);
          await noteStage(current.id, `Avatar render failed: ${String(e.message || e).slice(0, 320)}`);
        }
      } finally { setBusy(false); }
    })();
  }, [project?.id, project?.status, project?.heygen_video_id, project?.heygen_video_url, busy, heygen, setProject, setError]);

  // Reload-recovery for scene planning: unlike the avatar and assembly stages
  // there is no server-side operation to reattach to — the planning call runs
  // only in the session that started it. A project sitting on 'scene_planning'
  // with nothing busy is therefore stranded (the "timing supporting scenes"
  // spinner forever); hand it back to style_choice with the reason so the
  // customer can confirm the style and retry.
  useEffect(() => {
    const current = project;
    if (!current?.id || current.status !== 'scene_planning' || busy || resumedPlanning.current === current.id) return;
    resumedPlanning.current = current.id;
    void (async () => {
      const why = 'Scene planning was interrupted before it finished. Confirm the visual style to plan the scenes again.';
      setError(why);
      const fallback: Partial<Project> = { status: 'style_choice', stage_note: why };
      await updateProject(current.id, fallback).catch(() => undefined);
      setProject((live) => live && live.id === current.id ? { ...live, ...fallback } : live);
      pipelineLog('assets', 'stuck-scene-planning-reopened', { projectId: current.id });
    })();
  }, [project?.id, project?.status, busy, setProject, setError]);

  // Reload-recovery for assembly: an in-flight Remotion render whose
  // operation id survived the reload is polled to completion instead of being
  // orphaned — the fix for long videos that “never assemble”.
  useEffect(() => {
    const current = project;
    const operationId = current?.render_operation_id;
    if (!current?.id || !operationId || current.status !== 'assembling' || busy || assembling.current) return;
    const key = `${current.id}:${operationId}`;
    if (resumedRender.current === key) return;
    resumedRender.current = key;
    assembling.current = true;
    assemblyCancelled.current = false;
    void (async () => {
      setBusy(true); setError(''); setNote('Reconnecting to the assembly render already in flight');
      const startedAt = current.assembly_job?.started_at || new Date().toISOString();
      const baseProgress = Math.min(90, Math.max(20, Number(current.assembly_job?.progress) || 20));
      await pushAssemblyJob(current.id, { status: 'assembling', progress: baseProgress, message: 'Reconnected to the render already in flight — rendering the final MP4…', started_at: startedAt, ...(current.assembly_job?.draft_version ? { draft_version: current.assembly_job.draft_version } : {}) });
      try {
        for (let i = 0; i < 1350; i += 1) {
          if (assemblyCancelled.current) { await cancelAssemblyRun(current.id); return; }
          // The bar keeps moving while the render runs — eased toward 94%.
          const eased = Math.min(94, Math.round(baseProgress + (94 - baseProgress) * (1 - Math.exp(-(i + 1) / 90))));
          const status = await forgeApi.assemblyStatus(current.id, String(operationId), eased);
          if (status.status === 'complete' && status.videoUrl) { await completeAssembly(current, String(status.videoUrl)); return; }
          if (status.status === 'failed') throw new Error(status.error || 'Assembly failed');
          await pushAssemblyJob(current.id, { status: 'assembling', progress: eased, message: 'Rendering the final MP4 on Cloud Run…', started_at: startedAt, operation_id: String(operationId) }, true);
          await sleep(4000);
        }
        throw new Error('Assembly is still rendering after 90 minutes. Retry assembly to submit a fresh render.');
      } catch (e: any) {
        await failAssembly(current.id, String(e?.message || e));
      } finally { assembling.current = false; setBusy(false); setNote(''); }
    })();
  }, [project?.id, project?.status, project?.render_operation_id, busy]);

  // Reload-recovery for a PORTRAIT (9:16) assembly: its FFmpeg composite is
  // one synchronous call that lives only in the browser session that made it —
  // there is no operation id to reattach to. A project parked on 'assembling'
  // with no render operation and a stale job heartbeat was orphaned by a
  // closed or refreshed tab, so it is failed ONCE with a plain reason and a
  // Retry button instead of sitting on a placeholder forever. A FRESH
  // heartbeat means another tab is still driving the run: the 4-second status
  // poll keeps repainting its live progress here, and this effect only steps
  // in if that heartbeat goes quiet.
  useEffect(() => {
    const current = project;
    if (!current?.id || current.status !== 'assembling' || current.render_operation_id || busy || assembling.current) return;
    const id = current.id;
    if (resumedPortrait.current === id) return;
    const heartbeatOf = () => current.assembly_job?.updated_at ? Date.parse(String(current.assembly_job.updated_at)) : 0;
    const orphaned = () => { const beat = heartbeatOf(); return !(beat && Date.now() - beat < ASSEMBLY_HEARTBEAT_STALE_MS); };
    const fail = () => {
      resumedPortrait.current = id;
      void failAssembly(id, 'Assembly was interrupted before it finished — the page running it was closed or refreshed. Every scene clip is kept, so retrying only redoes the final composition.');
    };
    if (orphaned()) { fail(); return; }
    const timer = window.setInterval(() => { if (orphaned()) { window.clearInterval(timer); fail(); } }, 15000);
    return () => window.clearInterval(timer);
  }, [project?.id, project?.status, project?.render_operation_id, project?.assembly_job?.updated_at, busy]);

  // The persisted assembly job. Step 7's live panel rebuilds from this single
  // JSON column after any reload, and other tabs read it through the status
  // poll. Every phase transition writes through immediately; mid-render
  // progress heartbeats are throttled to one row write per 8 seconds.
  async function pushAssemblyJob(projectId: string, job: AssemblyJob, throttled = false) {
    const stamped: AssemblyJob = { ...job, updated_at: new Date().toISOString() };
    setProject((live) => live && live.id === projectId ? { ...live, assembly_job: stamped } : live);
    const now = Date.now();
    if (throttled && now - assemblyJobPersistedAt.current < 8000) return;
    assemblyJobPersistedAt.current = now;
    await updateProject(projectId, { assembly_job: stamped }).catch(() => undefined);
  }

  // Step 7's Cancel button. The poll loops and the portrait FFmpeg fetch all
  // watch this; a render already submitted server-side simply stops being
  // tracked — nothing already produced is lost.
  function cancelAssembly() {
    if (!assembling.current) return;
    assemblyCancelled.current = true;
    assemblyAbort.current?.abort();
    setNote('Cancelling the assembly…');
  }

  // Settle a cancelled run: the project rests on 'checks' (the same place a
  // failed assembly rests) with a note that says nothing broke.
  async function cancelAssemblyRun(projectId: string) {
    pipelineLog('joiner', 'cancelled', { projectId });
    const stamp = new Date().toISOString();
    const job: AssemblyJob = { status: 'cancelled', progress: 0, message: 'Assembly cancelled — nothing was changed. Start it again when ready.', finished_at: stamp, updated_at: stamp };
    const changes: Partial<Project> = { status: 'checks', checks: [], stage_note: 'Assembly cancelled — run it again when ready', render_operation_id: null, assembly_job: job };
    await updateProject(projectId, changes).catch(() => undefined);
    setProject((live) => live && live.id === projectId ? { ...live, ...changes } : live);
  }

  // The stage note outlives both the banner and the session, so each step
  // points it at what is happening now rather than at the last thing that
  // broke — an image failure from an earlier run otherwise reads as live.
  async function noteStage(projectId: string, stage_note: string) {
    await updateProject(projectId, { stage_note }).catch(() => undefined);
    setProject((live) => live && live.id === projectId ? { ...live, stage_note } : live);
  }

  // Any timeline-affecting edit (overlays, timing, text) bumps the DirectorPlan
  // draft version. Every render stamps the version it was submitted with, so
  // an output of an OLDER draft is shown but never promoted over a newer edit
  // — the stale-render protection half of atomic versioning.
  async function bumpDraftVersion() {
    const current = project;
    if (!current) return;
    const plan = planOf(current);
    const next: DirectorPlan = plan
      ? { ...plan, draft_version: plan.draft_version + 1 }
      : { version: 1, generation_id: String(current.generation_id || newGenerationId()), draft_version: 2, created_at: new Date().toISOString(), music: { required: false }, captions: false, treatments: [] };
    await patch({ director_plan: next as any, ...(current.generation_id ? {} : { generation_id: next.generation_id }) });
  }

  // PROVIDER HEALTH. The top-bar picker shows what this workspace can really
  // use: Runway and HeyGen are probed live, Group A is the platform baseline.
  // An unconfigured provider is greyed out WITH its setup note — never a
  // crash, and never a silent switch to a different engine.
  useEffect(() => {
    let cancelled = false;
    probeProviders()
      .then((statuses) => { if (!cancelled) setProviders(statuses); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setProvidersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // The ElevenLabs catalog is a free read, loaded once so the Audio tab
  // opens on the whole list rather than a spinner.
  useEffect(() => {
    let cancelled = false;
    fetchElevenVoices()
      .then((catalog) => { if (!cancelled) setElevenVoices(catalog.voices); })
      .catch((e: any) => { if (!cancelled) setElevenVoicesError(String(e?.message || 'The ElevenLabs voice catalog could not be loaded.')); })
      .finally(() => { if (!cancelled) setElevenVoicesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function refreshProviders() {
    setProvidersLoading(true);
    probeProviders({ force: true })
      .then(setProviders)
      .catch(() => undefined)
      .finally(() => setProvidersLoading(false));
  }

  // Restore the workbench exactly as the customer left it the moment their
  // project opens — script draft, brand accent, cards, provider.
  useEffect(() => {
    const id = project?.id;
    if (!id || studioLoadedFor.current === id) return;
    studioLoadedFor.current = id;
    const loaded = studioConfigOf(project);
    const provider = loaded.provider || DEFAULT_SCENE_PROVIDER;
    setSceneVideoEngine(provider);
    setStudio({ ...loaded, provider, script_draft: loaded.script_draft || String(project?.script || '') });
    setSelectedSceneId(null);
  }, [project?.id]);

  // AUTO-SAVE. Every workbench edit is written back a beat later, so closing
  // the tab mid-sentence never loses a script or a card.
  useEffect(() => {
    const id = project?.id;
    if (!id || studioLoadedFor.current !== id) return;
    window.clearTimeout(studioSaveTimer.current);
    studioSaveTimer.current = window.setTimeout(() => { void saveStudioConfig(id, studio).catch(() => undefined); }, 1200);
    return () => window.clearTimeout(studioSaveTimer.current);
  }, [studio, project?.id]);

  function patchStudio(patch: Partial<StudioConfig>) {
    // The scene generator keeps its own engine preference, so the two can
    // never disagree about which provider a Generate All run will use.
    if (patch.provider) setSceneVideoEngine(patch.provider);
    setStudio((current) => ({ ...current, ...patch }));
  }

  // DOWNLOAD. The finished MP4 is fetched and handed to the browser as a real
  // file; when the cross-origin read is refused the URL is opened instead, so
  // the customer always ends up with the video rather than a dead button.
  async function downloadFilm() {
    const url = String(project?.final_video_url || project?.assembled_video_url || '');
    if (!url) return;
    const name = `${String(project?.topic || 'sceneforge').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'sceneforge'}.mp4`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 15000);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  // Gemini Vision over the scene's first frame: detected objects, mood,
  // setting, palette and the B-roll terms the picker offers.
  async function analyzeScene(scene: Scene) {
    if (analyzingSceneId) return;
    setAnalyzingSceneId(scene.id);
    try {
      const context = await runSceneVision(scene, { force: true });
      if (context) setScenes((all) => all.map((item) => item.id === scene.id ? ({ ...item, vision_context: context } as Scene) : item));
      else setSceneImageError(`Scene ${scene.scene_index}: Gemini Vision could not read a frame from this clip in this browser, so there is no scene context for it. The film itself is unaffected.`);
    } finally { setAnalyzingSceneId(null); }
  }

  // 'Auto-apply graphics': a vision-grounded lower third and subject callout
  // on every analyzed scene. Hand-made overlays are kept.
  async function autoApplyGraphics() {
    if (!project || autoGraphicsBusy) return;
    setAutoGraphicsBusy(true); setAutoGraphicsNote('');
    try {
      const changed = await applyAutoGraphics(scenes, studio, { withCallouts: true });
      setScenes(await listScenes(project.id));
      if (changed) await bumpDraftVersion();
      setAutoGraphicsNote(changed
        ? `Graphics written on ${changed} scene${changed === 1 ? '' : 's'} — press Export to render them into the film.`
        : 'No scene has a readable visual yet. Generate the clips first, or press Analyze on a scene in Context.');
    } catch (e: any) {
      setAutoGraphicsNote(`The graphics pass failed: ${String(e?.message || e).slice(0, 200)}`);
    } finally { setAutoGraphicsBusy(false); }
  }

  async function applyBroll(scene: Scene, clip: BrollClip | null) {
    try {
      await setSceneBroll(scene, clip);
      setScenes((all) => all.map((item) => item.id === scene.id ? ({ ...item, broll: clip } as Scene) : item));
      await bumpDraftVersion();
    } catch (e: any) {
      setSceneImageError(`The B-roll could not be saved: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  async function uploadAudioTrack(file: File) {
    setMusicNote('Uploading your audio track…');
    try {
      const uploaded = await uploadFile(file, 'sceneforge-audio');
      patchStudio({ audio_track_url: uploaded.url });
      setMusicNote('Audio track saved — the next export mounts it under the narration, ducked so the voice stays clear.');
    } catch (e: any) {
      setMusicNote(`That audio file could not be uploaded: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  // A clip that just landed is merged UNDER whatever line the customer has
  // typed since: the text column is theirs, the rest is the generator's.
  function mergeSceneAudio(sceneId: string, entry: StudioConfig['audio']['scenes'][string]) {
    setStudio((current) => ({
      ...current,
      audio: { ...current.audio, scenes: { ...current.audio.scenes, [sceneId]: { ...entry, text: current.audio.scenes[sceneId]?.text || entry.text } } },
    }));
  }

  // PER-SCENE VOICEOVER: ONE ElevenLabs request narrates every scene whose
  // line has no current clip in the chosen voice. Each clip comes back with
  // its measured duration and is kept on the project, so re-running after
  // editing one line bills one line.
  async function narrateSceneLines() {
    if (!project || audioBusy) return;
    const pending = scenesNeedingVoice(scenes, project, studio.audio);
    if (!pending.length) { setAudioNote('Every scene already has a current clip in this voice.'); return; }
    setAudioBusy(true);
    setAudioNote(`Narrating ${pending.length} scene${pending.length === 1 ? '' : 's'} with ElevenLabs — one request for the whole batch…`);
    try {
      const next = await narrateScenes(scenes, project, studio.audio);
      pending.forEach((scene) => { if (next[scene.id]) mergeSceneAudio(scene.id, next[scene.id]); });
      const spokenMs = pending.reduce((sum, scene) => sum + (next[scene.id]?.duration_ms || 0), 0);
      await bumpDraftVersion();
      setAudioNote(`${pending.length} scene${pending.length === 1 ? '' : 's'} narrated · ${(spokenMs / 1000).toFixed(1)}s of speech. ${studio.audio.mode === 'lipsync' ? 'Press Lip-sync to render the presenter to these clips, or ' : ''}Press Export to hear them in the film.`);
      pipelineLog('assets', 'scene-voiceover-ready', { projectId: project.id, sceneCount: pending.length, voiceId: studio.audio.voice_id, spokenMs });
    } catch (e: any) {
      setAudioNote(String(e?.message || e));
      pipelineLog('assets', 'scene-voiceover-error', { projectId: project.id, message: String(e?.message || e) });
    } finally { setAudioBusy(false); }
  }

  // LIP-SYNC: HeyGen renders the chosen look speaking each scene's
  // ElevenLabs clip — caller audio, so HeyGen's own text-to-speech is never
  // used. Scenes are persisted as they settle, so a closed tab keeps every
  // clip already paid for; a missing HeyGen key is reported in the
  // platform's own words and leaves every scene on voiceover.
  async function lipsyncSceneLines() {
    if (!project || audioBusy) return;
    const heygenStatus = providers.find((entry) => entry.id === 'heygen');
    if (heygenStatus?.state === 'unconfigured') { setAudioNote(`${heygenStatus.note} Every scene plays as voiceover until then.`); return; }
    if (!studio.audio.lipsync_avatar_id) { setAudioNote('Pick a lip-sync presenter first.'); return; }
    const pending = scenesNeedingLipsync(scenes, project, studio.audio);
    if (!pending.length) {
      setAudioNote(scenesNeedingVoice(scenes, project, studio.audio).length
        ? 'Narrate the lines first — lip-sync renders the presenter to the ElevenLabs clips.'
        : 'Every narrated scene already has a lip-sync clip of this presenter.');
      return;
    }
    setAudioBusy(true);
    setAudioNote(`Rendering ${pending.length} lip-synced scene${pending.length === 1 ? '' : 's'} in HeyGen, two at a time — each takes a minute or two…`);
    try {
      const outcome = await lipsyncScenes(scenes, project, studio.audio, {
        aspectRatio: project.aspect_ratio,
        unconfiguredNote: heygenStatus?.note || undefined,
        onScene: mergeSceneAudio,
      });
      if (outcome.rendered) await bumpDraftVersion();
      setAudioNote(outcome.unavailable
        ? `${outcome.unavailable} Every scene stays on voiceover until then.`
        : `${outcome.rendered} lip-synced scene${outcome.rendered === 1 ? '' : 's'} ready${outcome.failed ? `; ${outcome.failed} fell back to voiceover — each row says why` : ''}. Press Export to render them into the film.`);
      pipelineLog('assets', 'scene-lipsync-complete', { projectId: project.id, rendered: outcome.rendered, failed: outcome.failed, unavailable: Boolean(outcome.unavailable) });
    } catch (e: any) {
      setAudioNote(String(e?.message || e));
      pipelineLog('assets', 'scene-lipsync-error', { projectId: project.id, message: String(e?.message || e) });
    } finally { setAudioBusy(false); }
  }

  async function uploadCharacterPhoto(file: File) {
    setCharacterNote('Uploading the character reference…');
    try {
      const uploaded = await uploadFile(file, 'sceneforge-characters');
      patchStudio({ character_photo_url: uploaded.url });
      setCharacterNote('Character reference saved. Scenes generated from now on send it with every request on engines that carry references.');
    } catch (e: any) {
      setCharacterNote(`That photo could not be uploaded: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  // Editing a scene's script invalidates its clip: the stored prompt is
  // cleared so the next generate actually re-films it instead of reusing the
  // old take.
  async function editSceneScript(scene: Scene, description: string) {
    if (!description) return;
    await patchScene(scene.id, { description, video_prompt: '', status: 'pending' });
    await bumpDraftVersion();
  }

  async function applyScript(script: string) {
    if (!project || !script.trim()) return;
    await patch({ script: script.trim() });
    patchStudio({ script_draft: script.trim() });
  }

  async function begin(input: Parameters<typeof start>[0]) {
    setBusy(true); setError('');
    try {
      const created = await start(input);
      setView('project');
      pipelineLog('script-llm', 'start', { projectId: created.id, model: settings.llm_model, targetLengthSec: input.target_length_sec });
      const result = await writeScript({ topic: input.topic, audience: input.audience, language: input.language, targetLengthSec: input.target_length_sec }, settings.llm_model);
      // The single orchestrator LLM returned one image brief per beat along
      // with the script; its scene-planning pass turns those into prompts.
      setImageBriefs(result.scene_image_briefs);
      const next: Partial<Project> = { status: 'script_review', script: result.script, sources: result.sources, estimated_duration_sec: result.estimated_duration_sec };
      await updateProject(created.id, next); setProject({ ...created, ...next });
      pipelineLog('script-llm', 'complete', { projectId: created.id, characters: result.script.length, sourceCount: result.sources.length, estimatedDurationSec: result.estimated_duration_sec });
    } catch (e: any) { pipelineLog('script-llm', 'error', { message: e.message || String(e) }); setError(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function rewrite(direction: string) {
    if (!project) return; setBusy(true); setError('');
    try { pipelineLog('script-llm', 'rewrite-start', { projectId: project.id, model: settings.llm_model }); const result = await writeScript({ topic: project.topic, audience: project.audience, language: project.language, targetLengthSec: project.target_length_sec, direction }, settings.llm_model); setImageBriefs(result.scene_image_briefs); await patch({ script: result.script, sources: result.sources, estimated_duration_sec: result.estimated_duration_sec }); pipelineLog('script-llm', 'rewrite-complete', { projectId: project.id, characters: result.script.length }); }
    catch (e: any) { pipelineLog('script-llm', 'error', { projectId: project.id, message: e.message }); setError(e.message); } finally { setBusy(false); }
  }

  async function approveScript(script: string) {
    // audio_strategy is fixed for v4 — the HeyGen master's narration runs
    // uninterrupted under all middle visuals — and is recorded the moment the
    // pipeline enters avatar_render instead of waiting for scene planning.
    await patch({ script, script_approved_at: new Date().toISOString(), status: 'avatar_render', audio_strategy: 'continuous_heygen_voiceover' });
  }

  async function generateAvatar(options: any) {
    if (!project) return; setBusy(true); setError('');
    try {
      pipelineLog('assets', 'audio-video-start', { projectId: project.id, provider: 'heygen', avatarId: options.avatar_id, voiceId: options.voice_id });
      await noteStage(project.id, 'Rendering the HeyGen avatar master…');
      const result = await heygen.generate(project, options);
      const next: Partial<Project> = { heygen_video_id: result.videoId, heygen_video_url: result.videoUrl, avatar_duration_sec: result.duration, word_timestamps: result.words, aspect_ratio: options.aspect_ratio, status: 'style_choice', heygen_chunks: [{ video_id: result.videoId, video_url: result.videoUrl, duration_sec: result.duration }] };
      // Merge into the CURRENT project: this callback ran for minutes, and a
      // stale full-object replace would resurrect state from before the render.
      await updateProject(project.id, next); setProject((live) => live && live.id === project.id ? { ...live, ...next } : live);
      await noteStage(project.id, 'Avatar master ready — choose the visual style');
      pipelineLog('assets', 'audio-video-complete', { projectId: project.id, videoId: result.videoId, durationSec: result.duration, timestampCount: result.words.length });
    } catch (e: any) {
      pipelineLog('assets', 'audio-video-error', { projectId: project.id, message: e.message, terminal: isTerminalRenderFailure(e) });
      setError(e.message || 'The avatar render failed. Press "Generate Avatar Video" to retry.');
      // A terminal HeyGen verdict means this render id is dead: clear it so
      // reopening the project offers a clean retry instead of auto-resuming
      // (and re-erroring on) a render HeyGen has already declared failed.
      if (isTerminalRenderFailure(e)) {
        await updateProject(project.id, { heygen_video_id: null }).catch(() => undefined);
        setProject((live) => live && live.id === project.id ? { ...live, heygen_video_id: null } : live);
      }
      // Park the reason on the project row so a stalled avatar_render project is
      // diagnosable (and retryable) even after this tab is gone. The message
      // itself already says what to do next (pollUntilReady writes it for
      // humans), so no extra suffix is appended.
      await noteStage(project.id, `Avatar render failed: ${String(e.message || e).slice(0, 320)}`);
    } finally { setBusy(false); }
  }

  async function confirmStyle() {
    if (!project?.style || !project.script) return; setBusy(true); setError('');
    try {
      setNote('Verger is timing supporting scenes against the avatar');
      await patch({ status: 'scene_planning', stage_note: 'Planning the supporting scenes' });
      const duration = Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec);
      // ONE GENERATION, ONE ID: every scene of this plan is stamped with the
      // same generation id, and the DirectorPlan stored on the project is the
      // single authoritative record reconciling scenes, generated assets,
      // overlay timeline, music treatment and the AssemblyComp props. The id
      // exists BEFORE planning so every window-by-window partial save already
      // carries it.
      const generationId = newGenerationId();
      // CHUNKED PLANNING (the Step 4 timeout fix): the film is planned in
      // narration windows — each LLM call writes only a few scenes and
      // settles far inside its 90-second bound, every finished window is
      // persisted immediately (a later failure or a reload keeps the finished
      // part), and the spinner reports real progress instead of a blank wait.
      const planned = await planScenes({ script: project.script, wordTimestamps: project.word_timestamps || [], style: project.style, sceneShare, uploads: [], durationSec: duration, imageBriefs }, settings.llm_model, {
        onWindow: ({ window: windowIndex, windowCount, scenesPlanned }) => {
          if (windowCount <= 1) return;
          const progress = `Planning the film — part ${windowIndex} of ${windowCount}${scenesPlanned ? ` · ${scenesPlanned} scene${scenesPlanned === 1 ? '' : 's'} planned so far` : ''}`;
          setNote(progress);
          void noteStage(project.id, progress);
          pipelineLog('assets', 'scene-plan-window', { projectId: project.id, window: windowIndex, windowCount, scenesPlanned });
        },
        persistPartial: async (scenesSoFar) => {
          await forgeApi.planScenes(project.id, scenesSoFar.map((scene: any) => ({ ...scene, generation_id: generationId })), { partial: true });
        },
      });
      // Keep overAvatar on both shapes. Landscape composes the callout inside
      // Remotion; portrait rasterizes the same scene copy to an RGBA PNG and
      // sends that full-frame transparent asset through the timed FFmpeg
      // overlay endpoint, so the presenter remains visible underneath.
      await replaceFromPlan(planned.scenes.map((scene: any) => ({ ...scene, generation_id: generationId })));
      const persistedRows = await listScenes(project.id);
      const directorPlan: DirectorPlan = {
        version: 1,
        generation_id: generationId,
        draft_version: 1,
        created_at: new Date().toISOString(),
        music: planned.music,
        captions: planned.captions,
        treatments: persistedRows.map((row) => ({ scene_index: row.scene_index, treatment: treatmentOfScene(row) })),
      };
      await patch({ status: 'scene_review', audio_strategy: planned.audio_strategy || 'continuous_heygen_voiceover', director_plan: directorPlan as any, generation_id: generationId });
    } catch (e: any) {
      // A failed or timed-out planning call must not strand the project on the
      // scene_planning spinner: the status returns to style_choice so the
      // customer sees the error and can confirm the style to retry.
      const why = String(e?.message || e);
      pipelineLog('assets', 'scene-plan-error', { projectId: project.id, message: why });
      setError(`Scene planning failed: ${why}`);
      await patch({ status: 'style_choice', stage_note: `Scene planning failed: ${why}`.slice(0, 480) }).catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function addSceneRange() {
    if (!project) return;
    const duration = Number(project.avatar_duration_sec || project.target_length_sec);
    const persistedScenes = await listScenes(project.id); const currentScenes = persistedScenes.length ? persistedScenes : scenes;
    const last = currentScenes[currentScenes.length - 1]; const startSec = Math.min(duration - 2, Math.max(5, last ? last.script_end_sec + 1 : 6));
    const nextSceneIndex = currentScenes.reduce((highest, scene) => Math.max(highest, scene.scene_index), 0) + 1;
    await add({ project_id: project.id, scene_index: nextSceneIndex, script_start_sec: startSec, script_end_sec: Math.min(duration - 1, startSec + 4), scene_type: 'text_beat', description: 'Describe the middle visual', image_prompts: ['A clear supporting visual element'], motion_notes: 'Smooth entrance and readable hold', suggested_user_uploads: [], status: 'pending', coding_status: 'pending', approved: false, visual_kind: 'text_overlay', overlay_config: defaultOverlay('Describe the middle visual'), video_prompt: '', spec: null });
  }

  async function uploadScene(scene: Scene, file: File) {
    if (!project) return; setBusy(true);
    // saveUpload's server function already wrote the scene's render_url — it
    // is a server-only column — so this only mirrors the result locally.
    try { const uploaded = await saveUpload(project.id, scene.id, scene.scene_index, file); setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: uploaded.public_url, status: 'ready' as const } : item)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  // Produce every supporting scene, in parallel, by its own kind. AI-video
  // scenes generate a real clip on the existing Omni pipeline and land
  // DIRECTLY on the timeline; text/graphics scenes at most draw one cached
  // still — their text, asset and preset effect are composed only inside the
  // ONE final assembly render. No per-scene Remotion render exists on either
  // path (that was the old pipeline's mistake).
  async function generateSupportingScenes() {
    if (!project) return; setBusy(true); setError(''); setSceneImageError('');
    cancelBatch.current = false;
    try {
      await patch({ status: 'asset_gen' });
      const style = getStyle(project.style);
      setNote('Producing supporting scenes in parallel — AI video clips and text/graphics assets side by side');
      pipelineLog('assets', 'start', { projectId: project.id, sceneCount: scenes.length, imageModel: settings.image_model, audioVideoReady: Boolean(project.heygen_video_url) });

      // The motion background runs alongside the scenes and is allowed to
      // fail: losing a backdrop texture must not lose the film.
      const motionPromise = ensureMotionBackground(project, style).catch((e: any) => {
        pipelineLog('assets', 'motion-background-skipped', { projectId: project.id, message: e?.message });
        return '';
      });

      // INDEPENDENT SCENES GENERATE IN PARALLEL: three lanes pull from one
      // queue and each scene is committed on its own, so scene 3 never waits
      // on scene 1 and one bad scene cannot take the batch down. Scenes that
      // already have their media (a fresh clip, a still, or a pure text
      // overlay) are skipped outright — existing work is reused, never paid
      // for twice.
      const persisted = await listScenes(project.id);
      setScenes(persisted);
      // The project's existing asset library, loaded once for the whole batch:
      // a scene that can reuse a matching generated/uploaded picture (same
      // subject, same character, its own earlier still) adopts it for free
      // instead of paying for a new generation.
      const reusePool = await listAssets(project.id).catch(() => [] as Asset[]);
      const queue = persisted.filter((scene) => sceneNeedsGeneration(scene)).sort((a, b) => a.scene_index - b.scene_index);
      const failures: string[] = [];
      const markScene = (id: string, changes: Partial<Scene>) => setScenes((all) => all.map((item) => item.id === id ? { ...item, ...changes } : item));
      // PER-SCENE PROGRESS. Three lanes pull from one queue, so the readout
      // reports the lowest scene still in flight plus how many have settled,
      // and estimates the remaining wait from the chosen engine's typical
      // clip time — "Generating scene 2 of 4 · about 3m left" rather than a
      // spinner with nothing behind it.
      const engineId = studio.provider || DEFAULT_SCENE_PROVIDER;
      const totalToMake = queue.length;
      const inFlight = new Set<number>();
      let completed = 0;
      const perClipSec = estimateSecondsPerClip(engineId);
      const reportProgress = (message: string) => setSceneProgress({
        active: true,
        done: completed,
        total: totalToMake,
        currentIndex: inFlight.size ? Math.min(...Array.from(inFlight)) : null,
        etaSec: Math.max(0, Math.ceil(((totalToMake - completed) / 3) * perClipSec)),
        message,
      });
      reportProgress(totalToMake ? `Producing ${totalToMake} scene${totalToMake === 1 ? '' : 's'} on ${engineId}` : 'Every scene already has its clip');
      const lane = async () => {
        for (;;) {
          // A cancelled batch stops pulling new work; the scene this lane is
          // already producing finishes normally and is kept.
          if (cancelBatch.current) return;
          const scene = queue.shift();
          if (!scene) return;
          inFlight.add(scene.scene_index);
          markScene(scene.id, { status: 'generating' });
          reportProgress(`Filming scene ${scene.scene_index}`);
          try {
            const kind = sceneKind(scene);
            if (kind === 'ai_video') {
              const made = await generateSceneVideo(project, scene, { model: engineId, characterRefUrl: studio.character_photo_url });
              markScene(scene.id, { render_url: made.videoUrl, video_prompt: sceneVideoPrompt(scene), status: 'ready' });
              // SCENE CONTEXT. The new clip's first frame goes straight to
              // Gemini Vision, so the sidebar can describe the shot and the
              // B-roll picker can suggest footage that matches it. A failed
              // read is silent by design — vision never gates the film.
              void runSceneVision({ ...scene, render_url: made.videoUrl } as Scene)
                .then((context) => { if (context) markScene(scene.id, { vision_context: context } as Partial<Scene>); })
                .catch(() => undefined);
              pipelineLog('scene-media', 'scene-video-ready', { projectId: project.id, sceneIndex: scene.scene_index, reused: made.reused });
            } else if (kind === 'motion_graphic' || kind === 'text_overlay') {
              // The GSAP+SVG engine records this scene right here in the
              // browser — deterministic text, real clip out — then the clip is
              // uploaded and composited exactly like any other scene video.
              // An annotated-image layout with no backdrop first adopts a
              // matching existing project asset, so the frame shows a real,
              // relevant picture instead of an empty placeholder.
              let target = scene;
              if (kind === 'motion_graphic') {
                const spec = sceneMotionSpec(scene);
                // Backdrop enrichment for EVERY motion-graphic kind, not just
                // annotated_image: a matching existing project asset is
                // adopted for free; otherwise, when the planner wrote a
                // backdrop brief (image_prompts[0]), a contextual image is
                // generated once and the engine dims it behind the graphic —
                // vivid scenes instead of flat cards, text always on top.
                if (!spec.imageUrl) {
                  const reusable = findReusableAsset(reusePool, scene);
                  let backdropUrl = reusable?.asset.public_url || '';
                  if (backdropUrl) pipelineLog('scene-media', 'motion-backdrop-reused', { projectId: project.id, sceneIndex: scene.scene_index, reason: reusable?.reason });
                  if (!backdropUrl && scene.image_prompts?.[0]) {
                    try {
                      const made = await ensureSceneImage(project, scene, style, settings.image_model);
                      backdropUrl = made.url;
                      pipelineLog('scene-media', 'motion-backdrop-generated', { projectId: project.id, sceneIndex: scene.scene_index, model: made.model });
                    } catch (backdropError: any) {
                      // The graphic still ships — just without a backdrop.
                      pipelineLog('scene-media', 'motion-backdrop-skipped', { projectId: project.id, sceneIndex: scene.scene_index, message: String(backdropError?.message || backdropError) });
                    }
                  }
                  if (backdropUrl) {
                    const enriched = { ...((scene.spec as Record<string, unknown>) || {}), imageUrl: backdropUrl };
                    await updateScene(scene.id, { spec: enriched }, project.id).catch(() => undefined);
                    target = { ...scene, spec: enriched };
                  }
                }
              }
              // DIRECTED PRODUCTION: the Motion Director writes the scene's
              // Visual Timeline, the GSAP engine captures it, and the visual
              // QA loop inspects rendered frames (auto-fix + re-render, max 2
              // retries; a scene still failing ships flagged, never silently).
              const ordered = persisted.filter((row) => row.status !== 'skipped').sort((a, b) => a.scene_index - b.scene_index);
              const position = ordered.findIndex((row) => row.id === scene.id);
              const made = await produceMotionScene(project, target, {
                neighbors: { prevKind: position > 0 ? sceneKind(ordered[position - 1]) : 'heygen', nextKind: position >= 0 && position < ordered.length - 1 ? sceneKind(ordered[position + 1]) : 'heygen' },
                onNote: setNote,
              });
              markScene(scene.id, { render_url: made.videoUrl, video_prompt: made.fingerprint, status: 'ready', qa_report: made.qa as unknown as Record<string, unknown>, director_timeline: made.scene.director_timeline, ...(target.spec !== scene.spec ? { spec: target.spec } : {}) });
              pipelineLog('scene-media', 'motion-clip-ready', { projectId: project.id, sceneIndex: scene.scene_index, qa: made.qa.status, qaIssues: made.qa.issues.length });
            } else {
              // Reuse first: an existing project asset that matches this
              // scene's subject is adopted for free before any generation.
              const reusable = findReusableAsset(reusePool, scene);
              if (reusable?.asset.public_url) {
                const adopted = await forgeApi.adoptUpload(project.id, scene.id, String(reusable.asset.public_url), `reuse-scene-${scene.scene_index}`);
                markScene(scene.id, { render_url: adopted.imageUrl || String(reusable.asset.public_url), status: 'ready' });
                pipelineLog('scene-media', 'scene-image-reused', { projectId: project.id, sceneIndex: scene.scene_index, reason: reusable.reason });
              } else {
                const made = await ensureSceneImage(project, scene, style, settings.image_model);
                markScene(scene.id, { render_url: made.url, status: 'ready' });
                pipelineLog('scene-media', 'scene-image-ready', { projectId: project.id, sceneIndex: scene.scene_index });
              }
            }
          } catch (e: any) {
            // One scene's failure is that scene's failure: it is marked so the
            // board can offer Retry / Text-Graphics / Skip, and the lanes keep
            // going instead of throwing away the scenes that worked. The
            // message names WHICH provider refused and WHY — status, reason
            // and the concrete next step — never a bare "Error generating".
            failures.push(sceneKind(scene) === 'ai_video'
              ? describeProviderFailure(String(e?.provider || engineId), e, { sceneIndex: scene.scene_index })
              : `Scene ${scene.scene_index}: ${String(e?.message || e)}`);
            await updateScene(scene.id, { status: 'error' }, project.id).catch(() => undefined);
            markScene(scene.id, { status: 'error' });
            pipelineLog('scene-media', 'scene-error', { projectId: project.id, sceneIndex: scene.scene_index, provider: String(e?.provider || engineId), status: e?.status, message: String(e?.message || e) });
          } finally {
            inFlight.delete(scene.scene_index);
            completed += 1;
            reportProgress(`${completed} of ${totalToMake} scenes settled`);
          }
        }
      };
      await Promise.all([lane(), lane(), lane()]);
      setSceneProgress({ active: false, done: completed, total: totalToMake, currentIndex: null, etaSec: 0, message: '' });
      const motionBg = await motionPromise;
      if (motionBg) await patch({ motion_bg_url: motionBg });
      const settledScenes = await listScenes(project.id);
      setScenes(settledScenes);
      pipelineLog('assets', 'complete', { projectId: project.id, settledScenes: settledScenes.filter(sceneSettled).length, motionBackgroundReady: Boolean(motionBg), failures: failures.length, cancelled: cancelBatch.current });
      if (cancelBatch.current) {
        // Cancellation is not a failure: completed scenes, the timeline and
        // the board all stay exactly as they are, and the remaining scenes
        // wait on the existing “Generate the remaining scenes” button.
        const waiting = settledScenes.filter((scene) => sceneNeedsGeneration(scene)).length;
        const cancelNote = `Generation cancelled — everything already produced is kept${waiting ? `; ${waiting} scene${waiting === 1 ? '' : 's'} still waiting` : ''}.`;
        setNote(cancelNote);
        await noteStage(project.id, cancelNote);
        return;
      }
      if (failures.length) {
        const plural = failures.length === 1 ? '' : 's';
        await noteStage(project.id, `${failures.length} supporting scene${plural} failed — retry, switch to Text/Graphics, or skip`);
        throw new Error(`${failures.length} supporting scene${plural} failed. ${failures[0]}. Each failed scene can be retried, switched to Text/Graphics, or skipped — the rest of the film is unaffected.`);
      }
      const readyNote = 'Every supporting scene is settled — ready to assemble';
      setNote(readyNote);
      await noteStage(project.id, readyNote);
    } catch (e: any) { pipelineLog('assets', 'error', { projectId: project.id, message: e.message }); setError(e.message); }
    finally { setBusy(false); setSceneProgress((live) => ({ ...live, active: false, currentIndex: null, etaSec: 0 })); }
  }

  // Cancel the batch without losing anything: in-flight clips finish and are
  // kept, waiting scenes stay pending, and the board stays where it is.
  function cancelGeneration() {
    if (!busy) return;
    cancelBatch.current = true;
    setNote('Cancelling — clips already in flight will finish and be kept');
  }

  // Per-scene recovery: a failed supporting scene is one click from being
  // retried, switched to Text/Graphics, or skipped — it never blocks the film.
  async function retryScene(scene: Scene) {
    if (!project || generatingSceneId) return;
    setGeneratingSceneId(scene.id); setSceneImageError('');
    setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, status: 'generating' as const } : item));
    try {
      const kind = sceneKind(scene);
      if (kind === 'ai_video') {
        const made = await generateSceneVideo(project, scene, { force: true, model: studio.provider || DEFAULT_SCENE_PROVIDER, characterRefUrl: studio.character_photo_url });
        setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: made.videoUrl, video_prompt: sceneVideoPrompt(scene), status: 'ready' as const } : item));
        void runSceneVision({ ...scene, render_url: made.videoUrl } as Scene)
          .then((context) => { if (context) setScenes((all) => all.map((item) => item.id === scene.id ? ({ ...item, vision_context: context } as Scene) : item)); })
          .catch(() => undefined);
      } else if (kind === 'motion_graphic' || kind === 'text_overlay') {
        const made = await produceMotionScene(project, scene, { force: true, onNote: setNote });
        setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: made.videoUrl, video_prompt: made.fingerprint, status: 'ready' as const, qa_report: made.qa as unknown as Record<string, unknown>, director_timeline: made.scene.director_timeline } : item));
      } else {
        const made = await generateSceneImage(project, scene, settings.image_model, getStyle(project.style));
        setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: made.url, status: 'ready' as const } : item));
      }
    } catch (e: any) {
      setSceneImageError(sceneKind(scene) === 'ai_video'
        ? describeProviderFailure(String(e?.provider || studio.provider || DEFAULT_SCENE_PROVIDER), e, { sceneIndex: scene.scene_index })
        : `Scene ${scene.scene_index}: ${String(e?.message || e)}`);
      await updateScene(scene.id, { status: 'error' }, project.id).catch(() => undefined);
      setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, status: 'error' as const } : item));
    } finally { setGeneratingSceneId(null); }
  }

  // Error recovery: a failed clip becomes a deterministic text-overlay scene
  // (captured by the motion engine on the next generate pass) — the film keeps
  // its beat with exact text instead of losing the scene.
  async function convertSceneToText(scene: Scene) {
    const overlay = scene.overlay_config && (scene.overlay_config.text || scene.overlay_config.subtext) ? scene.overlay_config : defaultOverlay(scene.description);
    await patchScene(scene.id, { visual_kind: 'text_overlay', overlay_config: overlay, status: 'pending' });
  }

  async function skipScene(scene: Scene) {
    await patchScene(scene.id, { status: 'skipped' });
  }

  async function unskipScene(scene: Scene) {
    const needs = sceneNeedsGeneration({ ...scene, status: 'pending' });
    await patchScene(scene.id, { status: needs ? 'pending' : 'ready' });
  }

  // The Scene editor's four-way type switch (AI Video / Image / Motion
  // Graphic / Text Overlay). Existing media is kept where it still fits the
  // new kind, so flipping back and forth never destroys paid work — only a
  // kind that genuinely needs different media re-queues the scene.
  async function switchSceneKind(scene: Scene, kind: VisualKind) {
    if (visualKindOf(scene.visual_kind) === kind && scene.visual_kind) return;
    const changes: Partial<Scene> = { visual_kind: kind };
    if ((kind === 'text_overlay' || kind === 'motion_graphic' || kind === 'text_graphics') && !scene.overlay_config) changes.overlay_config = defaultOverlay(scene.description);
    if (kind === 'motion_graphic' && !scene.spec) changes.spec = specFromOverlay(scene.overlay_config, scene.description) as any;
    // A motion-capture fingerprint parked in video_prompt is not an AI video
    // prompt — switching to AI Video restages the prompt from the scene text.
    if (kind === 'ai_video' && (!scene.video_prompt || isMotionFingerprint(scene.video_prompt))) changes.video_prompt = [String(scene.description || '').trim(), String(scene.motion_notes || '').trim()].filter(Boolean).join('. ');
    const probe = { ...scene, ...changes, status: 'pending' } as Scene;
    changes.status = sceneNeedsGeneration(probe) ? 'pending' : 'ready';
    await patchScene(scene.id, changes);
  }

  // Single-scene regeneration is retryScene() for every kind — the workbench
  // context menu routes Regenerate straight to it, so there are no
  // per-kind duplicates of the same action to drift apart.

  // ElevenLabs music bed. The bed is laid under the picture by the assembly
  // render itself (see mixMusic and remotion/AssemblyComp), so generating one
  // only produces the track.
  async function makeMusic(prompt: string) {
    if (!project) return; setMusicBusy(true); setMusicNote('');
    try {
      const seconds = Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec) || 30;
      const result = await forgeApi.music(project.id, prompt || undefined, seconds);
      setProject((current) => current ? { ...current, music_url: result.musicUrl, music_prompt: result.prompt } : current);
      setMusicNote(project.aspect_ratio === '9:16'
        ? 'Music bed ready - preview and download it below. A 9:16 master keeps the presenter audio, so this bed stays a separate track.'
        : 'Music bed ready - preview it below, then add it to the film.');
    } catch (e: any) { setMusicNote(e.message || String(e)); } finally { setMusicBusy(false); }
  }

  // ADDING MUSIC = RENDERING THE FILM WITH IT. A 16:9 master is produced by
  // the ONE Remotion assembly, and that composition now mounts the bed itself
  // (same ducking the draft preview plays), so the bed is laid down by a
  // render of the timeline rather than by a second pass that re-encodes the
  // finished master - the pass that was handing back a film with no music.
  // Portrait keeps its own answer below: its FFmpeg compositor can only carry
  // the presenter's own audio.
  async function mixMusic() {
    if (!project) return;
    if (project.aspect_ratio !== '9:16') {
      const projectId = project.id;
      const bed = String(project.music_url || '');
      setMusicBusy(true); setMusicNote('Rendering the film with the music bed under the narration...');
      try {
        await assemble();
        // The render stamps the bed it carried onto the finished job, so this
        // reports what the film actually contains rather than that a render
        // was attempted.
        const settled = await getProject(projectId).catch(() => null);
        setMusicNote(settled?.assembly_job?.status === 'completed' && String(settled.assembly_job.music_url || '') === bed
          ? 'The film now carries the music bed, ducked under the narration. Play it above to hear the mix.'
          : 'The film has not picked up the bed yet - the assembly panel above shows what happened. Start the render again when ready.');
      } finally { setMusicBusy(false); }
      return;
    }
    setMusicBusy(true); setMusicNote('Mixing the music bed under the film…');
    const projectId = project.id;
    const expectedSec = Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec) || 0;
    try {
      let result = await forgeApi.mixMusic(projectId);
      for (let i = 0; i < 60 && result.pending; i += 1) { await sleep(5000); result = await forgeApi.mixStatus(projectId); }
      // MIX OUTPUT GATE — the same principle as completeAssembly's: a render's
      // HTTP "complete" is never taken as success. The platform renderer can
      // serve a stale composition bundle that paints nothing (a full-length,
      // all-black, silent MP4 that still decodes cleanly — the documented
      // remotion-render-probe failure mode), so the mixed master must exist,
      // decode to the expected length AND show a real picture before it
      // replaces the assembled cut in the player. A rejected mix clears the
      // final_video_url the server persisted at completion, so the working
      // assembled film keeps playing instead of a black screen.
      if (result.mixed && result.finalUrl) {
        const url = result.finalUrl;
        setMusicNote('Mix rendered — verifying the master before it replaces the film…');
        const verification = await verifyRenderOutput(url, expectedSec);
        const sweep = verification.ok ? await runFilmQa(url, verification) : null;
        const blackFilm = Boolean(sweep && sweep.status !== 'skipped' && sweep.black_frames > 0);
        if (!verification.ok || blackFilm) {
          const why = verification.ok ? `${sweep?.black_frames} of ${sweep?.frames_sampled} sampled frames are black.` : verification.reason;
          await updateProject(projectId, { final_video_url: null, stage_note: 'Music mix rejected — the mixed file failed verification; the film without music is unchanged' }).catch(() => undefined);
          setProject((current) => current && current.id === projectId ? { ...current, final_video_url: null } : current);
          setMusicNote(`The mix produced a broken master and was not used: ${why} The assembled film is untouched — press “Mix music into the film” to try again.`);
          return;
        }
        setProject((current) => current && current.id === projectId ? { ...current, final_video_url: url } : current);
        setMusicNote(result.note || 'The final master now carries the music bed.');
        return;
      }
      setMusicNote(result.note || (result.mixed ? 'The final master now carries the music bed.' : 'Still mixing — reopen this project in a moment to pick it up.'));
    } catch (e: any) { setMusicNote(e.message || String(e)); } finally { setMusicBusy(false); }
  }

  // Shared by a live assemble() and the reload-resume path: writes the
  // finished film, runs the six checks, and settles the project status.
  async function completeAssembly(current: Project, videoUrl: string) {
    const projectId = current.id;
    const mergeProject = (changes: Partial<Project>) => setProject((live) => live && live.id === projectId ? { ...live, ...changes } : live);
    const [sceneRows, assets] = await Promise.all([listScenes(projectId), listAssets(projectId)]);
    const timeline = buildTimeline(current, sceneRows, assets);
    // OUTPUT VERIFICATION GATE: a render's HTTP "complete" is never taken as
    // success. The file must exist, be non-empty, and decode to the expected
    // length BEFORE it replaces anything — a failed verification preserves the
    // previous working output untouched.
    const expectedSec = timelineDurationInFrames(timeline, Number(current.avatar_duration_sec || current.estimated_duration_sec || current.target_length_sec) || 0) / 30;
    const verification = await verifyRenderOutput(videoUrl, expectedSec);
    if (!verification.ok) {
      await failAssembly(projectId, `The render finished but its output failed verification: ${verification.reason} Retry the assembly.`);
      return;
    }
    const previousHash = current.build_hash;
    const hash = `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    const editorManifest = { version: 2, avatarVideoUrl: current.heygen_video_url, scenes: sceneRows.map((scene) => ({ ...scene, assets: assets.filter((asset) => asset.scene_id === scene.id) })), timeline };
    const startedAt = current.assembly_job?.started_at;
    const submittedDraft = Number(current.assembly_job?.draft_version) || 0;
    const checkingJob: AssemblyJob = { status: 'checking', progress: 96, message: 'Running final quality checks…', started_at: startedAt, updated_at: new Date().toISOString(), ...(submittedDraft ? { draft_version: submittedDraft } : {}) };
    // A fresh assembled cut supersedes any earlier music mix — that mix was
    // rendered from the PREVIOUS cut, and the player prefers final_video_url,
    // so keeping it would show a stale (or broken) master over the new film.
    // The bed itself is kept, and a 16:9 re-render carries it inside the new
    // cut, so nothing has to be mixed on top afterwards.
    const next = { ...current, assembled_video_url: videoUrl, final_video_url: null, build_hash: hash, editor_manifest: editorManifest, status: 'checks' as const, assembly_job: checkingJob };
    await updateProject(projectId, { assembled_video_url: videoUrl, final_video_url: null, build_hash: hash, editor_manifest: editorManifest, status: 'checks', render_operation_id: null, stage_note: 'Running the delivery checks', assembly_job: checkingJob });
    mergeProject(next);
    // The six mechanical checks plus the film-level output QA (verified file +
    // black/frozen frame sweep) — eight verdicts in one list.
    const qa = await runFilmQa(videoUrl, verification);
    const checks = [...await runChecks(next, sceneRows, assets, previousHash), ...filmQaChecks(verification, qa)];
    // STALE-RESULT PROTECTION: if the plan was edited while this render was in
    // flight, this output is an OLDER draft — it is shown, but never promoted
    // to the last known good version, and the note says to re-render.
    const fresh = await getProject(projectId).catch(() => null);
    const liveDraft = Number((planOf(fresh || current) || { draft_version: 1 }).draft_version) || 1;
    const staleDraft = submittedDraft > 0 && liveDraft > submittedDraft;
    const finalStatus = checks.every((check) => check.pass) ? 'done' as const : 'checks' as const;
    const stageNote = staleDraft
      ? 'Film assembled from an older draft — the plan changed during the render; re-render to include the newest edits'
      : finalStatus === 'done' ? 'Film assembled, output verified, and all delivery checks passed' : 'Film assembled — some checks still need attention';
    const doneStamp = new Date().toISOString();
    // A cut rendered WITH the bed records it, so Step 7 can tell a scored
    // film from one assembled before the music existed.
    const scored = current.aspect_ratio !== '9:16' && Boolean(current.music_url);
    const completedJob: AssemblyJob = { ...(scored ? { music_url: current.music_url } : {}), status: 'completed', progress: 100, message: scored ? 'Film assembled with its music bed - the final MP4 is loaded in the player.' : 'Film assembled — the final MP4 is loaded in the player.', started_at: startedAt, finished_at: doneStamp, updated_at: doneStamp, output_url: videoUrl, ...(submittedDraft ? { draft_version: submittedDraft } : {}) };
    // ATOMIC PROMOTION: only a render that completed, verified its output and
    // passed every check — for the CURRENT draft — becomes last_good_version.
    const promote = finalStatus === 'done' && !staleDraft;
    const lastGood = promote ? { draft_version: submittedDraft || liveDraft, generation_id: (fresh || current).generation_id || null, video_url: videoUrl, build_hash: hash, promoted_at: doneStamp } : undefined;
    await updateProject(projectId, { checks, status: finalStatus, stage_note: stageNote, assembly_job: completedJob, final_qa_report: qa as any, ...(lastGood ? { last_good_version: lastGood } : {}) });
    mergeProject({ ...next, checks, status: finalStatus, stage_note: stageNote, assembly_job: completedJob, final_qa_report: qa as any, ...(lastGood ? { last_good_version: lastGood } : {}) });
    pipelineLog('joiner', 'complete', { projectId, videoUrlReady: Boolean(videoUrl), verifiedBytes: verification.bytes, checksPassed: checks.filter((check) => check.pass).length, checkCount: checks.length, finalStatus, promoted: Boolean(lastGood), staleDraft });
  }

  // Park the reason on the project so Step 7 can explain the failure and
  // offer the retry even after a reload, and leave the status somewhere that
  // is not “forever assembling”.
  async function failAssembly(projectId: string, why: string) {
    pipelineLog('joiner', 'error', { projectId, message: why });
    setError(why);
    const failStamp = new Date().toISOString();
    const failedJob: AssemblyJob = { status: 'failed', progress: 0, message: 'Assembly did not finish', error: why.slice(0, 480), finished_at: failStamp, updated_at: failStamp };
    // The previous assembled/last-good output columns are deliberately NOT
    // touched here — a failed render never replaces a working video.
    const failed: Partial<Project> = { status: 'checks', checks: [], stage_note: `${ASSEMBLY_FAILED_PREFIX} ${why} The last working video is preserved.`.slice(0, 480), render_operation_id: null, assembly_job: failedJob };
    await updateProject(projectId, failed).catch(() => undefined);
    setProject((live) => live && live.id === projectId ? { ...live, ...failed } : live);
  }

  async function assemble() {
    // A second click while a render is in flight would start a parallel render
    // and leave two operations writing the same project.
    if (!project || assembling.current) return;
    // The same guard across tabs: a job whose heartbeat is fresh is being
    // driven by another session — show its live state instead of starting a
    // twin render against the same project.
    const liveBeat = project.assembly_job?.updated_at ? Date.parse(String(project.assembly_job.updated_at)) : 0;
    if (assemblyJobRunning(project.assembly_job) && liveBeat && Date.now() - liveBeat < ASSEMBLY_HEARTBEAT_STALE_MS) { setNote('Assembly is already running — its live progress is shown below.'); return; }
    if (!project.heygen_video_url) { setError('This project has no avatar master yet, so there is nothing to assemble against.'); return; }
    let current = project;
    if (isExpiredHeyGenSignedUrl(String(current.heygen_video_url || ''))) {
      try {
        const freshUrl = await refreshAvatarVideoUrl(current);
        current = { ...current, heygen_video_url: freshUrl };
      } catch (e: any) {
        setError(String(e?.message || 'The avatar video link could not be refreshed.'));
        return;
      }
    }
    const projectId = current.id;
    const mergeProject = (changes: Partial<Project>) => setProject((live) => live && live.id === projectId ? { ...live, ...changes } : live);
    assembling.current = true;
    assemblyCancelled.current = false;
    assemblyAbort.current = new AbortController();
    // One mutable job object is the single source every push spreads from, so
    // no phase transition ever loses started_at or rewinds progress.
    const job: AssemblyJob = { status: 'preparing', progress: 3, message: 'Preparing the assembly…', started_at: new Date().toISOString() };
    const push = (changes: Partial<AssemblyJob>, throttled = false) => { Object.assign(job, changes); return pushAssemblyJob(projectId, { ...job }, throttled); };
    // Time-eased progress while FFmpeg or the renderer works: the bar
    // asymptotically approaches `to` against the film's expected render time,
    // so it moves DURING the render instead of jumping from 0 to 100.
    let stopTicker: (() => void) | null = null;
    const easeTicker = (from: number, to: number, expectedSec: number, message: string) => {
      const t0 = Date.now();
      const timer = window.setInterval(() => {
        const elapsed = (Date.now() - t0) / 1000;
        const eased = Math.round(from + (to - from) * (1 - Math.exp(-(elapsed / expectedSec) * 1.4)));
        if (eased > job.progress) void push({ progress: Math.min(to, eased), message }, true);
      }, 2000);
      return () => window.clearInterval(timer);
    };
    setBusy(true); setError(''); setNote('Building the final timeline');
    try {
      pipelineLog('joiner', 'start', { projectId, sceneCount: scenes.length, scriptReady: Boolean(current.script), audioVideoReady: Boolean(current.heygen_video_url) });
      // A retry starts from a clean slate: the previous attempt's checks and
      // failure note are not this attempt's verdict.
      const opening: Partial<Project> = { status: 'assembling', checks: [], stage_note: 'Building the final timeline', assembly_job: { ...job, updated_at: new Date().toISOString() } };
      await updateProject(projectId, opening); mergeProject(opening);
      const assets = await listAssets(projectId); const timeline = buildTimeline(current, scenes, assets); let videoUrl = '';
      if (!timeline.length) throw new Error('The timeline came out empty. Approve at least one scene — or re-record the avatar so its duration is known — then assemble again.');
      // TIMELINE VALIDATION GATE (Director layer): durations, overlaps,
      // boundaries, asset reachability, generation stamps, explicit presenter
      // states, overlay timing and z-order, PIP configuration, music and
      // captions are checked deterministically HERE — an invalid timeline is
      // rejected before any production render is paid for.
      setNote('Validating the timeline before the render');
      await push({ progress: 6, message: 'Validating the timeline…' });
      const validation = await validateTimeline(current, scenes, timeline);
      await updateProject(projectId, { timeline_report: validation as any }).catch(() => undefined);
      if (!validation.ok) throw new Error(`The timeline failed validation: ${validation.errors.slice(0, 3).join(' ')}${validation.errors.length > 3 ? ` (+${validation.errors.length - 3} more issues)` : ''}`);
      job.draft_version = validation.draft_version;
      // The render length comes from the timeline itself, so a scene that runs
      // past the recorded avatar duration is not cut off and a project with no
      // duration at all still renders instead of being rejected.
      const durationInFrames = timelineDurationInFrames(timeline, Number(current.avatar_duration_sec || current.estimated_duration_sec || current.target_length_sec) || 0);
      pipelineLog('joiner', 'timeline-ready', { projectId, segmentCount: timeline.length, codedSceneRenders: timeline.filter((segment) => segment.sceneRenderKind === 'video').length, assetCount: assets.length, durationInFrames, musicBed: Boolean(current.music_url) });
      const clipCount = timeline.filter((segment) => segment.type === 'scene').length;
      const filmSec = Math.max(10, Math.round(durationInFrames / 30));
      await push({ progress: 10, message: `Preparing ${clipCount} video clip${clipCount === 1 ? '' : 's'}…` });
      if (current.aspect_ratio === '9:16') {
        setNote('FFmpeg is compositing the middle visuals around the talking head — narration audio runs uninterrupted underneath');
        // The portrait compositor carries only the base video's audio and has
        // no input for a per-scene track, so the Audio tab's clips cannot
        // reach this export. The panel says so; this just leaves a trace.
        if (studio.audio.mode !== 'off') pipelineLog('joiner', 'scene-audio-unsupported-portrait', { projectId, mode: studio.audio.mode });
        await push({ progress: 14, message: 'Compositing scene overlays and presenter callouts…' });
        // The endpoint accepts only full-frame assets, but its FFmpeg pipeline
        // preserves PNG alpha. That alpha channel is what powers the
        // COMPOSITION MODES here: an overlay/central motion graphic ships as a
        // short sequence of timed 1080x1920 RGBA stills (transparent
        // everywhere except the graphic tile, sampled from the same GSAP
        // timeline the preview plays) so it builds up OVER the visible
        // presenter; an overlay/central image ships as a framed card PNG; only
        // fullscreen cutaways, AI clips and full-bleed stills cover the frame.
        const sceneById = new Map<string, Scene>(scenes.map((scene): [string, Scene] => [scene.id, scene]));
        const overlayGroups = await Promise.all(timeline.filter((segment) => segment.type === 'scene').map(async (segment): Promise<{ asset_url: string; start_time: number; end_time: number; position: 'full' }[]> => {
          const sourceScene = segment.sceneId ? sceneById.get(segment.sceneId) : undefined;
          const startTime = segment.startSec;
          const endTime = segment.startSec + segment.frames / 30;
          if (segment.overlay?.overAvatar === true) {
            if (!sourceScene) throw new Error('An over-avatar callout lost its source scene. Reopen the project and assemble again.');
            const calloutUrl = await generatePortraitCalloutImage(current, sourceScene);
            return [{ asset_url: calloutUrl, start_time: startTime, end_time: endTime, position: 'full' }];
          }
          const comp = segment.composition;
          if (sourceScene && comp && (comp.mode === 'overlay' || comp.mode === 'central')) {
            const kind = visualKindOf(sourceScene.visual_kind);
            if (kind === 'motion_graphic' || kind === 'text_overlay') {
              try {
                const frames = await generatePortraitMotionOverlayFrames(current, sourceScene, { mode: comp.mode, position: comp.position as any, scale: comp.scale });
                pipelineLog('joiner', 'composited-motion-overlay', { projectId, sceneIndex: sourceScene.scene_index, mode: comp.mode, frameCount: frames.length });
                return frames.map((frame) => ({ asset_url: frame.url, start_time: Math.round((startTime + frame.start) * 1000) / 1000, end_time: Math.round(Math.min(endTime, startTime + frame.end) * 1000) / 1000, position: 'full' as const })).filter((entry) => entry.end_time > entry.start_time);
              } catch (compositeError: any) {
                // The captured clip below still ships the scene — as a cutaway —
                // rather than losing the beat over a failed transparent frame.
                pipelineLog('joiner', 'motion-overlay-fallback', { projectId, sceneIndex: sourceScene.scene_index, message: String(compositeError?.message || compositeError) });
              }
            } else if (kind === 'image') {
              try {
                const cardUrl = await generatePortraitImageCardPng(current, sourceScene, { mode: comp.mode, position: comp.position as any, scale: comp.scale });
                pipelineLog('joiner', 'composited-image-card', { projectId, sceneIndex: sourceScene.scene_index, mode: comp.mode });
                return [{ asset_url: cardUrl, start_time: startTime, end_time: endTime, position: 'full' }];
              } catch (cardError: any) {
                pipelineLog('joiner', 'image-card-fallback', { projectId, sceneIndex: sourceScene.scene_index, message: String(cardError?.message || cardError) });
              }
            }
            // ai_video: the portrait compositor only takes full-frame inputs,
            // so AI clips remain full-screen cutaways in 9:16 by design.
          }
          let assetUrl = segment.sceneRenderUrl || segment.assetUrls?.[0] || '';
          if (assetUrl && isVideoUrl(assetUrl) && sourceScene) {
            // PRE-FLIGHT. ffmpeg fails the ENTIRE composite with exit 234 when
            // one overlay clip has no readable video stream — the signature of
            // a broken browser capture (a MediaRecorder run in a hidden tab) is
            // a header-only file of about 1 KB. Catch it here and recover
            // instead of shipping a doomed request.
            const bytes = await overlayAssetBytes(assetUrl);
            if (bytes !== null && bytes < BROKEN_CLIP_MAX_BYTES) {
              const kind = visualKindOf(sourceScene.visual_kind);
              pipelineLog('joiner', 'broken-overlay-clip', { projectId, sceneIndex: sourceScene.scene_index, bytes, kind });
              if (kind === 'motion_graphic') {
                setNote(`Scene ${sourceScene.scene_index}'s motion clip had no frames — re-capturing it before the composite`);
                assetUrl = (await generateSceneMotionClip(current, sourceScene, { force: true })).videoUrl;
              } else if (kind === 'text_overlay' || kind === 'text_graphics') {
                setNote(`Scene ${sourceScene.scene_index}'s captured clip had no frames — compositing its text as a safe-zone callout instead`);
                assetUrl = await generatePortraitCalloutImage(current, sourceScene);
              } else {
                throw new Error(`Scene ${sourceScene.scene_index}'s video file is empty (${bytes} bytes), so ffmpeg cannot composite it. Regenerate that scene's clip, then assemble again.`);
              }
            }
          }
          return assetUrl ? [{ asset_url: assetUrl, start_time: startTime, end_time: endTime, position: 'full' }] : [];
        }));
        const overlays = overlayGroups.flat();
        // Zero overlays is not an error: the endpoint's zero-overlay call is the
        // sanctioned portrait re-encode, so the film still ships as a verified
        // 1080×1920 MP4 of the talking head instead of failing the assembly.
        if (!overlays.length) setNote('No middle visuals were ready — delivering the portrait master re-encoded as a verified 1080×1920 MP4');
        // FFmpeg starts NOW: the job flips to 'assembling' before the call is
        // awaited, and the ticker keeps the bar moving while it runs.
        await push({ status: 'assembling', progress: 30, message: 'Mixing narration and composited visuals — FFmpeg is rendering the final MP4…' });
        stopTicker = easeTicker(30, 92, Math.max(60, filmSec * 1.5), 'Rendering the final MP4…');
        const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/videos/overlay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() }, body: JSON.stringify({ base_video_url: current.heygen_video_url, overlays, dimensions: { width: 1080, height: 1920 }, output_format: 'mp4', duration_seconds: current.avatar_duration_sec }), signal: assemblyAbort.current?.signal });
        stopTicker(); stopTicker = null;
        const data = await response.json().catch(() => ({})); if (!response.ok || !data.overlayUrl) throw new Error(data.error || 'Portrait assembly failed'); videoUrl = data.overlayUrl;
      } else {
        const submitRender = async () => {
          // Captions are a Director decision: word-timed chunks derived from
          // the avatar master's timestamps, rendered TOPMOST by the composition.
          const captions = planOf(current)?.captions ? captionChunks(current.word_timestamps) : [];
          // THE MUSIC BED TRAVELS WITH THE RENDER. The project's bed, its
          // level and the narration windows it ducks under are part of the
          // props, so the film comes out of this one render already scored -
          // the bed is no longer dropped and then chased with a second mix
          // pass that re-encodes the finished master.
          const music = musicBedProps(current);
          // THE POST-PROCESSING LAYER rides with this same render. Once every
          // scene clip exists, the finished film is NOT the raw generated
          // footage: this one server-side pass draws the branded title card,
          // the per-scene lower thirds, the chosen transition language, the
          // muted B-roll picture-in-picture and the closing CTA over the
          // clips. Because Remotion composites at the render's own frame
          // rate, those graphics come out frame-accurate and crisp instead of
          // re-encoded from a browser capture — and the narration, the music
          // bed and any uploaded audio track all survive untouched, because
          // nothing is re-encoded after this.
          const finishing = postProductionProps(studio, current, durationInFrames);
          const trimmedTimeline = studio.lower_thirds
            ? timeline
            : timeline.map((segment) => segment.overlayElements
              ? { ...segment, overlayElements: segment.overlayElements.filter((element) => element.type !== 'lower_third') }
              : segment);
          // PER-SCENE SPEECH rides this same render. Each scene's ElevenLabs
          // clip (or the HeyGen clip lip-synced to it) is stamped on its
          // segment; the composition mounts it inside the scene's Sequence,
          // mutes the presenter master for that window, and the music bed
          // ducks under those lines exactly as it ducks under the presenter.
          // This is the only native path that puts a per-scene voice inside
          // the MP4 — the overlay and stitch routes keep base audio only.
          const finishedTimeline = stampTimelineAudio(trimmedTimeline, studio.audio);
          const speech = [...(Array.isArray((music as any).speech) ? (music as any).speech as [number, number][] : []), ...sceneSpeechWindows(finishedTimeline)];
          const started = await forgeApi.assemblySubmit(projectId, {
            compositionTsx: createAssemblySource(durationInFrames),
            props: {
              timeline: finishedTimeline,
              avatarVideoUrl: current.heygen_video_url,
              motionBgUrl: current.motion_bg_url,
              captions,
              ...music,
              ...(speech.length ? { speech } : {}),
              ...finishing,
            },
            durationInFrames,
            job: { ...job, status: 'assembling', progress: Math.max(job.progress, 18), message: 'Rendering the final MP4 on Cloud Run…' },
          });
          if (!started.operationId) throw new Error(started.error || 'Assembly render could not start');
          const operationId = String(started.operationId);
          job.operation_id = operationId;
          // The server persisted the operation id before responding. This local
          // merge only repaints immediately; closing the tab cannot orphan it.
          mergeProject({ render_operation_id: operationId, stage_note: 'Rendering the Remotion assembly on Cloud Run' });
          await push({ status: 'assembling', progress: Math.max(job.progress, 18), message: 'Rendering the final MP4 on Cloud Run…', operation_id: operationId });
          // Long films render long: polling may stop with the tab, but Cloud Run
          // does not. Reopening reads the same operation id and continues here.
          const pollCap = Math.max(450, Math.ceil(durationInFrames / 30) * 6);
          for (let i = 0; i < pollCap; i += 1) {
            if (assemblyCancelled.current) throw new Error(ASSEMBLY_CANCELLED);
            await sleep(3000);
            const eased = Math.min(92, Math.round(18 + 74 * (1 - Math.exp(-((i + 1) * 2) / Math.max(90, filmSec * 2)))));
            const status = await forgeApi.assemblyStatus(projectId, operationId, eased);
            if (status.status === 'complete' && status.videoUrl) return String(status.videoUrl);
            if (status.status === 'failed') throw new Error(status.error || 'Assembly failed');
            if (eased > job.progress) await push({ progress: eased, operation_id: operationId }, true);
          }
          throw new Error('Assembly timed out. Resume this project to check again.');
        };
        // The renderer resolves a published bundle per workspace and has been
        // measured answering with a STALE one: a composition submitted by an
        // earlier render, whose resolution error then surfaces on this film.
        // Resubmitting rebuilds the bundle, so a resolution or service failure
        // is retried before the film is given up on.
        const transient = /COMPOSITION_INVALID|could not be resolved|RENDER_SERVICE_FAILED|render service|Cloud Run|temporarily unavailable|Target closed/i;
        let lastError = '';
        for (let attempt = 1; attempt <= 3 && !videoUrl; attempt += 1) {
          setNote(attempt === 1 ? 'Rendering the 1920 by 1080 Remotion assembly' : `The renderer answered from a stale bundle — resubmitting the assembly (attempt ${attempt} of 3)`);
          if (attempt > 1) await push({ message: `The renderer answered from a stale bundle — resubmitting the assembly (attempt ${attempt} of 3)` });
          try {
            videoUrl = await submitRender();
          } catch (e: any) {
            lastError = String(e?.message || e);
            pipelineLog('joiner', 'render-attempt-failed', { projectId, attempt, message: lastError });
            if (attempt === 3 || !transient.test(lastError)) throw new Error(lastError);
            await sleep(5000);
          }
        }
        if (!videoUrl) throw new Error(lastError || 'Assembly failed');
      }
      await completeAssembly(current, videoUrl);
    } catch (e: any) {
      if (stopTicker) { stopTicker(); stopTicker = null; }
      const why = String(e?.message || e);
      // A cancel is not a failure: the run settles as 'cancelled' and nothing
      // already produced is lost.
      if (assemblyCancelled.current || why.includes(ASSEMBLY_CANCELLED) || e?.name === 'AbortError') await cancelAssemblyRun(projectId);
      else await failAssembly(projectId, why);
    } finally { if (stopTicker) stopTicker(); assembling.current = false; assemblyAbort.current = null; setBusy(false); setNote(''); }
  }

  function openEditor() {
    if (!project?.assembled_video_url) return;
    const payload = { url: project.assembled_video_url, title: project.topic, mode: 'edit', manifest: project.editor_manifest, ts: Date.now() };
    localStorage.setItem('sceneforge_handoff_v1', JSON.stringify(payload)); localStorage.setItem('sceneforge_editor_manifest_v2', JSON.stringify(payload));
    void patch({ status: 'editing' }); window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'video-enhancer' } }));
  }

  // Everything the chat model needs to understand the CURRENT project —
  // compact on purpose: full scripts and word-level timestamps add thousands
  // of tokens without improving routing, so the script ships as an excerpt
  // and every scene as a one-line summary.
  function vergerContext() {
    if (!project) return {};
    return {
      project: { topic: project.topic, status: project.status, style: project.style, aspect_ratio: project.aspect_ratio, duration_sec: Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec) || 0, has_avatar: Boolean(project.heygen_video_url), assembled: Boolean(project.assembled_video_url), music_ready: Boolean(project.music_url), script_excerpt: String(project.script || '').slice(0, 1500) },
      scenes: scenes.map((scene) => ({ index: scene.scene_index, start_sec: scene.script_start_sec, end_sec: scene.script_end_sec, kind: sceneKind(scene), status: scene.status, description: String(scene.description || '').slice(0, 160), has_media: Boolean(scene.render_url) })),
      asset_count: projectAssets.length,
    };
  }

  async function askVerger(override?: string) {
    const requested = (override ?? vergerText).trim();
    if (!project || !requested) return; setBusy(true);
    const request = requested;
    setVergerText('');
    setVergerMessages((all) => [...all, { role: 'user', text: request }]);
    const say = (text: string) => setVergerMessages((all) => [...all, { role: 'verger', text }]);
    try {
      const routed = await routeChangeRequest(request, vergerContext(), settings.llm_model); const editing = project.status === 'scene_review';
      await (window as any).__workspaceDb.from('verger_requests').insert({ project_id: project.id, request_text: request, route: routed.route, action_taken: routed.action, status: editing && routed.route === 'scene' ? 'queued' : 'applied', queued_until_user_save: editing && routed.route === 'scene' });
      if (editing && routed.route === 'scene') say('I queued that scene change and will apply it after you finish the active scene edits.');
      else if (routed.route === 'script') { await rewrite(request); say('I rewrote the script for you. Review the updated draft.'); }
      else if (routed.route === 'style') { await patch({ status: 'style_choice' }); say('I routed this to the style system. Choose or confirm the new treatment.'); }
      else if (routed.route === 'scene') {
        // If replanning dies mid-flight the project must not stay parked on
        // the scene_planning spinner — restore the status it had before.
        const statusBefore = project.status;
        await patch({ status: 'scene_planning' });
        try {
          const duration = Number(project.avatar_duration_sec || project.target_length_sec);
          // The change request rides with the CURRENT plan (so "keep everything
          // else" is grounded in what exists) and plans in the same bounded
          // windows as Step 4 — no single call ever has to write the whole film.
          const planned = await planScenes({ script: project.script || '', wordTimestamps: project.word_timestamps || [], style: project.style || 'vox-explainer', sceneShare, uploads: [], durationSec: duration, imageBriefs, changeRequest: request, currentScenes: scenes as any }, settings.llm_model, {
            onWindow: ({ window: windowIndex, windowCount }) => { if (windowCount > 1) setNote(`Replanning the film — part ${windowIndex} of ${windowCount}`); },
          });
          await replaceFromPlan(planned.scenes);
          await patch({ status: 'scene_review' });
          say('I replanned the affected visual range. Review and approve the scenes.');
        } catch (planError: any) {
          await patch({ status: statusBefore }).catch(() => undefined);
          throw planError;
        }
      }
      else { say('I routed the request to assembly — rebuilding the final timeline now.'); await assemble(); }
    } catch (e: any) { say(friendlyErrorText(e.message || String(e))); } finally { setBusy(false); }
  }

  // AI status panel above the chat: plain pipeline facts (what is done, what
  // is running, what is next), never chain-of-thought. Derived live from the
  // project and its scenes on every render.
  const vergerSteps: { label: string; state: 'done' | 'active' | 'todo' }[] = !project ? [] : (() => {
    const settledCount = scenes.filter(sceneSettled).length;
    const generating = project.status === 'asset_gen' || project.status === 'coding';
    return [
      { label: 'Script written', state: project.script ? 'done' as const : project.status === 'scripting' ? 'active' as const : 'todo' as const },
      { label: 'Avatar rendered', state: project.heygen_video_url ? 'done' as const : project.status === 'avatar_render' ? 'active' as const : 'todo' as const },
      { label: 'Scene plan created', state: scenes.length ? 'done' as const : project.status === 'scene_planning' ? 'active' as const : 'todo' as const },
      { label: scenes.length ? `Scenes produced · ${settledCount} of ${scenes.length}` : 'Scenes produced', state: scenes.length > 0 && settledCount === scenes.length ? 'done' as const : generating ? 'active' as const : 'todo' as const },
      { label: 'Film assembled', state: project.assembled_video_url ? 'done' as const : project.status === 'assembling' ? 'active' as const : 'todo' as const },
      { label: 'Delivery checks', state: project.status === 'done' ? 'done' as const : project.status === 'checks' && project.assembled_video_url ? 'active' as const : 'todo' as const },
    ];
  })();

  // Vidverge Agent — the floating orb assistant. SceneForge's natural-language
  // control surface is Verger, so the agent drafts instructions and routes
  // them straight into the Verger pipeline on the customer's behalf.
  const agentContext = {
    appId: 'sceneforge',
    appName: 'SceneForge',
    currentInputs: {
      view,
      projectTopic: project ? String(project.topic || '').slice(0, 160) : 'none',
      projectStatus: project ? String(project.status || '') : 'none',
      vergerDraft: vergerText.slice(0, 400),
    },
    onFillField: (field: string, value: string) => {
      if (field === 'instruction' || field === 'vergerText') { setVergerText(value); setVergerOpen(true); }
    },
    onTriggerAction: (action: string, params?: Record<string, unknown>) => {
      const p = params || {};
      if (action === 'sendToVerger') {
        if (!project) { setError('Open or start a project first — Verger works on the current project.'); return; }
        setVergerOpen(true);
        const instruction = typeof p.instruction === 'string' ? p.instruction : undefined;
        void askVerger(instruction);
      } else if (action === 'openVerger') setVergerOpen(true);
      else if (action === 'openAssetStudio') { if (project) setAssetStudioOpen(true); }
      else if (action === 'assemble') { if (project) void assemble(); }
      else if (action === 'newProject') { setProject(null); setView('project'); }
    },
    promptHint: [
      'The user composes multi-scene avatar explainer films. Verger (the in-app orchestrator) applies plain-English changes to the open project: script rewrites, scene additions, scene type/description changes, style switches, re-assembly.',
      'Fields you can fill: instruction (drafts a Verger instruction into its panel for the user to review).',
      'Actions you can trigger: sendToVerger with {"instruction":"..."} (routes the change straight into the pipeline — use this to add scenes, e.g. "add a scene after scene 2 showing a bar chart of adoption", or to regenerate), openVerger, openAssetStudio (generate still assets for scenes), assemble (rebuild the final film), newProject (start a fresh topic).',
      'sendToVerger, openAssetStudio and assemble need an open project — check projectStatus first; when it is "none", guide the user to start or open a project.',
    ].join('\n'),
  };

  // Everything the workbench needs, assembled once per render.
  const exportJob = project?.assembly_job || null;
  const exporting = Boolean(project && (project.status === 'assembling' || assemblyJobRunning(exportJob)));
  const stageNote = String(project?.stage_note || '');
  const assemblyFailure = !busy && project && !project.assembled_video_url && stageNote.startsWith(ASSEMBLY_FAILED_PREFIX)
    ? friendlyErrorText(stageNote.slice(ASSEMBLY_FAILED_PREFIX.length).trim())
    : '';
  const failedChecks = (project?.checks || []).filter((check) => !check.pass);
  const workbenchNote = [
    note,
    failedChecks.length ? `Delivery checks need attention — ${failedChecks.map((check) => `${check.label}: ${check.detail}`).join(' · ')}` : '',
  ].filter(Boolean).join(' · ');
  const pendingWindows = scenes.filter((scene) => sceneNeedsGeneration(scene)).map((scene) => Number(scene.script_end_sec) - Number(scene.script_start_sec));
  const workbenchMode = Boolean(project && view === 'project' && WORKBENCH_STATUSES.includes(project.status));

  const workbench = project ? <StudioWorkbench
    project={project}
    scenes={scenes}
    config={studio}
    onConfig={patchStudio}
    providers={providers}
    providersLoading={providersLoading}
    onRefreshProviders={refreshProviders}
    estimate={estimateGeneration(pendingWindows, studio.provider || DEFAULT_SCENE_PROVIDER)}
    progress={sceneProgress}
    busy={busy}
    note={workbenchNote}
    error={error ? friendlyErrorText(error) : assemblyFailure}
    onDismissError={() => setError('')}
    selectedSceneId={selectedSceneId}
    onSelectScene={setSelectedSceneId}
    onGenerateAll={() => void generateSupportingScenes()}
    onCancelGenerate={() => { if (exporting) cancelAssembly(); else cancelGeneration(); }}
    onExport={() => void assemble()}
    onDownload={() => void downloadFilm()}
    exportBusy={exporting}
    exportProgress={Number(exportJob?.progress) || 0}
    exportMessage={String(exportJob?.message || '')}
    finalVideoUrl={String(project.final_video_url || project.assembled_video_url || '')}
    onRegenerateScene={(scene) => void retryScene(scene)}
    onDeleteScene={(scene) => void remove(scene.id)}
    onAddScene={() => void addSceneRange()}
    onConvertScene={(scene) => void convertSceneToText(scene)}
    onFilmAsVideo={(scene) => void switchSceneKind(scene, 'ai_video')}
    onSkipScene={(scene) => void skipScene(scene)}
    onUnskipScene={(scene) => void unskipScene(scene)}
    onEditSceneScript={(scene, description) => void editSceneScript(scene, description)}
    onUploadSceneMedia={(scene, file) => void uploadScene(scene, file)}
    generatingSceneId={generatingSceneId}
    onSaveScript={(script) => void applyScript(script)}
    onRewriteScript={(direction) => void rewrite(direction)}
    onPlanScenes={() => void confirmStyle()}
    onAnalyzeScene={(scene) => void analyzeScene(scene)}
    analyzingSceneId={analyzingSceneId}
    onAutoGraphics={() => void autoApplyGraphics()}
    autoGraphicsBusy={autoGraphicsBusy}
    autoGraphicsNote={autoGraphicsNote}
    onSetBroll={(scene, clip) => void applyBroll(scene, clip)}
    onGenerateMusic={(prompt) => void makeMusic(prompt)}
    onMixMusic={() => void mixMusic()}
    musicBusy={musicBusy}
    musicNote={musicNote}
    onUploadAudioTrack={(file) => void uploadAudioTrack(file)}
    elevenVoices={elevenVoices}
    elevenVoicesLoading={elevenVoicesLoading}
    elevenVoicesError={elevenVoicesError}
    onNarrateScenes={() => void narrateSceneLines()}
    onLipsyncScenes={() => void lipsyncSceneLines()}
    audioBusy={audioBusy}
    audioNote={audioNote}
    avatars={heygen.avatars}
    voices={heygen.voices}
    charactersLoading={heygen.catalogLoading}
    charactersError={heygen.catalogError}
    characterNote={characterNote || heygen.progress}
    onGenerateAvatar={(options) => void generateAvatar({ ...options, resolution: '1080p', aspect_ratio: project.aspect_ratio, fit: 'cover', background: { type: 'color', value: '#0f172a' }, voice_settings: { speed: 1 }, captions: false, gestures: false, output_format: 'mp4' })}
    onUploadCharacterPhoto={(file) => void uploadCharacterPhoto(file)}
    onOpenLibrary={() => { setView('library'); setProject(null); void refreshLibrary(); }}
    onOpenSettings={() => setView('settings')}
    onOpenAssistant={() => setVergerOpen(true)}
  /> : null;

  const content = () => {
    if (view === 'settings') return <SettingsPanel />;
    if (view === 'library') return <Library projects={projects} loading={loading} onOpen={(id) => { void open(id); setView('project'); }} onNew={() => { setProject(null); setView('project'); }} />;
    if (!project) return <TopicInput busy={busy} initialTopic={initialTopic} initialAttachment={initialAttachment} onStart={(input) => void begin(input)} />;
    if (project.status === 'scripting') return <Working text="Researching and writing your script" />;
    if (project.status === 'script_review') return <ScriptReview key={project.script} initialScript={project.script || ''} sources={project.sources || []} busy={busy} onApprove={(script) => void approveScript(script)} onRewrite={(direction) => void rewrite(direction)} />;
    if (project.status === 'avatar_render') return <HeyGenModule avatars={heygen.avatars} voices={heygen.voices} catalogLoading={heygen.catalogLoading} catalogError={heygen.catalogError} aspectRatio={project.aspect_ratio} progress={heygen.progress} busy={busy} videoUrl={project.heygen_video_url} refreshingVideoLink={refreshingVideoLink} onVideoError={() => void refreshAvatarVideoUrl(project).catch((e: any) => setError(String(e?.message || e)))} onGenerate={(options) => void generateAvatar(options)} />;
    if (project.status === 'style_choice') return <StylePicker value={project.style} onChange={(style) => void patch({ style })} onConfirm={() => void confirmStyle()} />;
    if (project.status === 'scene_planning') return <Working text={note || 'Verger is timing supporting scenes against the avatar'} />;
    if (project.status === 'editing') return <EditorHandoff project={project} scenes={scenes} onOpen={openEditor} />;
    // From the scene plan onward there is ONE surface, not a stack of step
    // screens: the workbench owns planning review, generation, the preview
    // and the export.
    if (WORKBENCH_STATUSES.includes(project.status)) return workbench;
    return <Working text="Restoring this project" />;
  };

  // The space surface token stays the base colour; the gradient rides on top of
  // it as a background IMAGE, so the shell theme still drives the palette.
  return <div className="sceneforge-app relative flex h-full min-h-[560px] flex-col overflow-hidden bg-[var(--space-surface-bg)] text-[var(--space-text-primary)]" style={{ backgroundImage: 'linear-gradient(160deg, #0d0d1a, #1a1033)' }}>
    <style>{`
      @keyframes sf-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes sf-pulse { 0%, 100% { opacity: .42; } 50% { opacity: .82; } }
      .sceneforge-app .sf-fade-up { animation: sf-fade-up .34s cubic-bezier(.22,.9,.3,1) both; }
      .sceneforge-app .sf-skeleton { animation: sf-pulse 1.5s ease-in-out infinite; }
      .sceneforge-app button, .sceneforge-app a { transition: transform .16s cubic-bezier(.22,.9,.3,1), background-color .16s ease, border-color .16s ease, box-shadow .2s ease, color .16s ease, opacity .16s ease; }
      .sceneforge-app button:active:not(:disabled), .sceneforge-app a:active { transform: scale(.97); }
      .sceneforge-app input:not([type='checkbox']):not([type='radio']), .sceneforge-app textarea, .sceneforge-app select, .sceneforge-app .input {
        border-color: var(--space-border-default); outline: none; box-shadow: 0 0 0 1px var(--space-border-strong);
        transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease;
      }
      .sceneforge-app input:not([type='checkbox']):not([type='radio']):focus, .sceneforge-app textarea:focus, .sceneforge-app select:focus, .sceneforge-app .input:focus {
        border-color: var(--space-brand-primary-500); box-shadow: 0 0 0 1px var(--space-brand-primary-500), 0 0 0 4px color-mix(in srgb, var(--space-brand-primary-500) 18%, transparent);
      }
      .sceneforge-app .sf-card { animation: sf-fade-up .34s cubic-bezier(.22,.9,.3,1) both; }
      @supports (interpolate-size: allow-keywords) {
        .sceneforge-app { interpolate-size: allow-keywords; }
        .sceneforge-app details::details-content { block-size: 0; opacity: 0; overflow: clip; transition: block-size .32s cubic-bezier(.22,.9,.3,1), opacity .22s ease; }
        .sceneforge-app details[open]::details-content { block-size: auto; opacity: 1; }
      }
      @media (max-width: 639px) {
        .sceneforge-app header { padding-inline: 12px; gap: 6px; }
        .sceneforge-app header > div:last-child button { font-size: 0; padding: 9px; }
        .sceneforge-app header > div:last-child button svg { width: 17px; height: 17px; }
      }
      @media (prefers-reduced-motion: reduce) { .sceneforge-app *, .sceneforge-app *::before, .sceneforge-app *::after { animation: none !important; transition-duration: 0.01ms !important; } }
    `}</style>
    {workbenchMode ? null : <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-5"><button onClick={() => { setView('library'); setProject(null); void refreshLibrary(); }} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 font-bold tracking-tight transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]">SceneForge</button><span className="hidden text-sm text-[var(--space-text-muted)] sm:block">Avatar-first explainers, directed scene by scene</span><div className="ml-auto flex gap-2"><button onClick={onExitToStudio} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-sm font-medium transition-all hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><Clapperboard className="h-4 w-4" />Avatar Studio</button>{project ? <button onClick={() => setAssetStudioOpen(true)} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-sm font-medium transition-all hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><ImagePlus className="h-4 w-4" />Asset Studio</button> : null}<button onClick={() => setVergerOpen(true)} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-sm font-medium transition-all hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><MessageSquareText className="h-4 w-4" />Verger</button><button aria-label="Settings" onClick={() => setView('settings')} className="rounded-xl border border-[var(--space-border-default)] p-2 transition-all hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><Settings className="h-4 w-4" /></button></div></header>}
    {!workbenchMode && error ? <div role="alert" className="sf-fade-up flex flex-wrap items-center gap-3 border-b border-[color-mix(in_srgb,var(--space-semantic-danger-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_14%,transparent)] px-4 py-3 text-sm leading-relaxed sm:px-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_14%,transparent)]"><AlertTriangle className="h-4 w-4 text-[var(--space-semantic-danger)]" /></span><span className="min-w-[min(100%,240px)] flex-1 text-[var(--space-text-secondary)]"><strong className="block text-[var(--space-text-primary)]">This step needs attention</strong>{friendlyErrorText(error)}</span><button onClick={() => window.location.reload()} className="flex items-center gap-1.5 rounded-xl bg-[var(--space-brand-primary-600)] px-3 py-2 text-xs font-semibold text-white"><RefreshCw className="h-3.5 w-3.5" />Retry</button><button aria-label="Dismiss error" onClick={() => setError('')} className="shrink-0 rounded-lg p-1.5 text-[var(--space-semantic-danger)] hover:bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_18%,transparent)]"><X className="h-4 w-4" /></button></div> : null}
    {!workbenchMode && project && vergerSteps.length ? <details className="shrink-0 border-b border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-5 py-2.5"><summary className="cursor-pointer text-xs font-semibold text-[var(--space-text-secondary)]">Production status — <span className="font-normal text-[var(--space-text-muted)]">{project.stage_note || note || (busy ? 'Working on the current stage' : 'Waiting for you')}</span></summary><div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">{vergerSteps.map((step) => <span key={step.label} className="flex items-center gap-2 text-xs">{step.state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-success)]" /> : step.state === 'active' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--space-text-brand)]" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--space-text-muted)]" />}<span className={step.state === 'todo' ? 'text-[var(--space-text-muted)]' : 'text-[var(--space-text-secondary)]'}>{step.label}</span></span>)}</div></details> : null}
    {refreshingVideoLink ? <div className="flex shrink-0 items-center gap-2 border-b border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-5 py-2 text-xs text-[var(--space-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--space-text-brand)]" />Refreshing video link…</div> : null}
    <main className={workbenchMode ? 'min-h-0 flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}>{content()}</main>
    {sceneImageError ? <div role="alert" className="sf-fade-up absolute bottom-4 left-4 right-4 z-30 flex max-w-sm flex-wrap items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,var(--space-surface-card))] p-4 text-sm text-[var(--space-text-primary)] shadow-2xl sm:left-auto sm:right-5"><AlertTriangle className="h-4 w-4 shrink-0 text-[var(--space-semantic-danger)]" /><span className="min-w-0 flex-1">{friendlyErrorText(sceneImageError)}</span><button onClick={() => window.location.reload()} className="flex items-center gap-1 rounded-lg bg-[var(--space-brand-primary-600)] px-2.5 py-1.5 text-xs font-semibold text-white"><RefreshCw className="h-3 w-3" />Retry</button><button aria-label="Dismiss image generation error" onClick={() => setSceneImageError('')} className="rounded-lg p-1"><X className="h-4 w-4" /></button></div> : null}
    {vergerOpen ? <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-xl flex-col border-l border-[var(--space-border-default)] bg-[var(--space-surface-card)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--space-border-default)] px-6 py-4"><div><h2 className="text-lg font-bold tracking-tight">Verger</h2><p className="mt-0.5 text-xs text-[var(--space-text-muted)]">Your project director — it knows this project, its scenes and its timeline</p></div><button aria-label="Close Verger" onClick={() => setVergerOpen(false)} className="rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><X className="h-5 w-5" /></button></div>
      {project && vergerSteps.length ? <div className="border-b border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-6 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--space-text-muted)]">Pipeline status</p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">{vergerSteps.map((step) => <span key={step.label} className="flex items-center gap-2 text-xs">{step.state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-success)]" /> : step.state === 'active' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--space-text-brand)]" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--space-text-muted)]" />}<span className={step.state === 'todo' ? 'text-[var(--space-text-muted)]' : 'text-[var(--space-text-secondary)]'}>{step.label}</span></span>)}</div>
      </div> : null}
      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {!vergerMessages.length ? <div className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-4 text-sm leading-relaxed text-[var(--space-text-secondary)]">Try “make scene 3 a pie chart”, “redo the script intro”, “make the first 10 seconds more engaging”, or “switch everything to documentary”. Active scene edits are queued, never overwritten.</div> : null}
        {vergerMessages.map((message, index) => message.role === 'user'
          ? <div key={index} className="ml-10 rounded-2xl rounded-br-md bg-[var(--space-brand-primary-600)] px-4 py-2.5 text-sm leading-relaxed text-white">{message.text}</div>
          : <div key={index} className="mr-10 rounded-2xl rounded-bl-md border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-4 py-2.5 text-sm leading-relaxed text-[var(--space-text-secondary)]">{message.text}</div>)}
        {busy && vergerMessages[vergerMessages.length - 1]?.role === 'user' ? <div className="mr-10 flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-4 py-2.5 text-sm text-[var(--space-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--space-text-brand)]" />Routing your request…</div> : null}
      </div>
      <div className="border-t border-[var(--space-border-default)] px-6 py-4">
        <textarea value={vergerText} onChange={(e) => setVergerText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void askVerger(); } }} rows={3} placeholder="Tell Verger what to change…" className="w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-[var(--space-text-primary)] transition-colors placeholder:text-[var(--space-text-muted)] focus:border-[var(--space-brand-primary-500)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--space-brand-primary-500)_25%,transparent)]" />
        <button disabled={busy || !project || !vergerText.trim()} onClick={() => void askVerger()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_4px_16px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40 disabled:shadow-none">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send to Verger</button>
      </div>
    </aside> : null}
    {assetStudioOpen && project ? <AssetStudio project={project} scenes={scenes} onAdopted={(sceneId, url) => setScenes((all) => all.map((scene) => scene.id === sceneId ? { ...scene, render_url: url, status: 'ready' as const } : scene))} onClose={() => setAssetStudioOpen(false)} /> : null}
    <AgentChatProvider appContext={agentContext}>
      <AgentChatButton />
      <AgentChatPanel />
    </AgentChatProvider>
  </div>;
}

function Working({ text }: { text: string }) { return <div className="flex h-full min-h-[420px] items-center justify-center px-4"><div className="sf-fade-up w-full max-w-sm rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-6 text-center shadow-xl"><Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--space-text-brand)]" /><p className="mt-4 font-semibold text-[var(--space-text-primary)]">{text}…</p><p className="mt-1 text-sm text-[var(--space-text-muted)]">Your progress is saved as each stage lands.</p><div className="mt-5 grid gap-2"><span className="sf-skeleton h-2.5 rounded-full bg-[var(--space-surface-muted)]" /><span className="sf-skeleton mx-auto h-2.5 w-3/4 rounded-full bg-[var(--space-surface-muted)]" /></div></div></div>; }
function Library({ projects, loading, onOpen, onNew }: { projects: Project[]; loading: boolean; onOpen: (id: string) => void; onNew: () => void }) { return <div className="mx-auto max-w-6xl px-6 py-10"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Your studio</p><h1 className="mt-2 text-3xl font-bold tracking-tight">SceneForge projects</h1></div><button onClick={onNew} className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)]"><Plus className="h-4 w-4" />New project</button></div>{loading ? <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]" />)}</div> : <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <button key={project.id} onClick={() => onOpen(project.id)} className="group rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--space-border-strong)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><FolderOpen className="h-5 w-5 text-[var(--space-text-brand)] transition-transform group-hover:scale-110" /><div className="mt-4 line-clamp-2 font-semibold leading-snug">{project.topic}</div><div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--space-text-muted)]">{project.status.replace(/_/g, ' ')} · {project.aspect_ratio}</div></button>)}{!projects.length ? <div className="col-span-full flex flex-col items-center rounded-2xl border border-dashed border-[var(--space-border-default)] px-8 py-14 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent)]"><Film className="h-6 w-6 text-[var(--space-text-brand)]" /></span><p className="mt-4 text-lg font-semibold text-[var(--space-text-primary)]">Direct your first explainer</p><p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--space-text-muted)]">Give SceneForge a topic — it researches the script, renders your avatar, and builds every supporting scene.</p><button onClick={onNew} className="mt-6 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-2.5 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)]"><Plus className="h-4 w-4" />Start a project</button></div> : null}</div>}</div>; }

// A brief routed here from the Vidverge Agent targets the full pipeline, so
// the handoff is PEEKED at (never consumed) before the opening surface is
// chosen — ForgePipeline is the only thing that may consume it.
function pipelineHandoffWaiting(): boolean {
  try {
    const raw = window.localStorage.getItem(VIDVERGE_HANDOFF_KEY);
    if (!raw) return false;
    const handoff = JSON.parse(raw);
    return Boolean(handoff && handoff.appId === 'sceneforge' && Date.now() - Number(handoff.ts || 0) < 30 * 60 * 1000);
  } catch { return false; }
}

function initialSurface(): Surface {
  if (pipelineHandoffWaiting()) return 'pipeline';
  try {
    const stored = window.localStorage.getItem(SURFACE_KEY);
    return stored === 'pipeline' || stored === 'suite' ? stored : 'studio';
  } catch { return 'studio'; }
}

export default function App() {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  // The post-production editor is a THIRD face of SceneForge, opened on a
  // finished avatar master. It is held as state rather than a route so the
  // studio behind it keeps its own render state while the editor is open.
  const [editorSource, setEditorSource] = useState<MotionEditorSource | null>(null);
  const show = (next: Surface) => {
    setSurface(next);
    try { window.localStorage.setItem(SURFACE_KEY, next); } catch { /* private mode — the choice just does not persist */ }
  };

  // HeyGen serves signed URLs that expire while a long edit is in progress;
  // the editor asks for a fresh one by video id instead of failing.
  const refreshEditorLink = async (videoId: string, staleUrl: string): Promise<string> => {
    const status = await fetchVideoStatus(videoId);
    if (status.status !== 'completed' || !status.videoUrl || status.videoUrl === staleUrl) {
      throw new Error(status.error || 'HeyGen has not made a fresh link for this video yet.');
    }
    return status.videoUrl;
  };

  if (editorSource) {
    return <MotionEditor source={editorSource} onClose={() => setEditorSource(null)} onRefreshLink={refreshEditorLink} />;
  }
  if (surface === 'suite') return <HeyGenConsole onBackToQuickRender={() => show('studio')} />;
  return surface === 'studio'
    ? <AvatarStudio onOpenPipeline={() => show('pipeline')} onOpenSuite={() => show('suite')} onOpenEditor={setEditorSource} />
    : <ForgePipeline onExitToStudio={() => show('studio')} />;
}
