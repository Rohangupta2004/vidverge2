import { useEffect, useRef, useState } from 'react';
import { Film, FolderOpen, Loader2, MessageSquareText, Plus, Send, Settings, X } from 'lucide-react';
import TopicInput from './components/TopicInput';
import ScriptReview from './components/ScriptReview';
import HeyGenModule from './components/HeyGenModule';
import StylePicker from './components/StylePicker';
import ScenePlanner from './components/ScenePlanner';
import AssetProgress from './components/AssetProgress';
import AssemblyProgress from './components/AssemblyProgress';
import EditorHandoff from './components/EditorHandoff';
import SettingsPanel from './components/SettingsPanel';
import { useProject } from './hooks/useProject';
import { useScenes } from './hooks/useScenes';
import { useHeyGen } from './hooks/useHeyGen';
import { writeScript } from './agents/scriptAgent';
import { decideScenes } from './agents/sceneDeciderAgent';
import { ensureMotionBackground, ensureSceneImage, generateSceneImage } from './agents/imageAgent';
import { SCENE_CODE_MAX_TOKENS, codeScene, renderScene } from './agents/codingAgent';
import { routeVergerRequest } from './agents/verger';
import { getStyle } from './styles/registry';
import { buildTimeline, createAssemblySource, timelineDurationInFrames } from './remotion/AssemblyComp';
import { runChecks } from './lib/checks';
import { saveUpload } from './lib/storage';
import { DEFAULT_SETTINGS, WORKSPACE_ID, listAssets, listScenes, loadSettings, updateProject, updateScene, type ForgeSettings, type Project, type Scene } from './lib/supabase';
import { forgeApi } from './lib/forge';
import { sleep, workspaceToken } from './lib/proxy';

type View = 'library' | 'project' | 'settings';

function pipelineLog(stage: 'script-llm' | 'assets' | 'remotion-coder' | 'joiner', event: string, details: Record<string, unknown> = {}) {
  console.info(`[SceneForge pipeline] ${stage}:${event}`, details);
}

// Why a render died is written into the project's stage note as well as the
// banner: the banner is gone after a reload, and Step 7 has to keep being able
// to explain itself and offer the retry.
const ASSEMBLY_FAILED_PREFIX = 'Assembly failed:';

export default function App() {
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
  const [vergerText, setVergerText] = useState('');
  const [vergerReply, setVergerReply] = useState('');
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const [sceneImageError, setSceneImageError] = useState('');
  const [imageBriefs, setImageBriefs] = useState<{ scene: number; brief: string }[]>([]);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicNote, setMusicNote] = useState('');
  // Guards assembly specifically. `busy` is shared with every other stage —
  // the Verger panel raises it before routing a request into assembly — so it
  // cannot tell a second Assemble click from a legitimate hand-off.
  const assembling = useRef(false);
  // A run that died inside a Claude call leaves its scene parked on
  // coding_status 'coding' with nobody left to finish it. Reopening the
  // project hands those scenes back to 'pending' once, so the board stops
  // spinning on work that is never coming.
  const stuckCodingReset = useRef('');

  useEffect(() => { loadSettings().then((value) => { setSettings(value); setSceneShare(value.default_scene_share); }).catch(() => undefined); }, []);
  useEffect(() => {
    if (!project?.id || project.status !== 'scene_review') return;
    let cancelled = false;
    listAssets(project.id).then((assets) => {
      if (cancelled) return;
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
        setProject((current) => current && current.id === id ? { ...current, ...status.project } : current);
        // Nothing left to watch once every scene has both halves and the board
        // is just waiting on the customer to press Assemble.
        const settled = (status.progress.assemble_ready && status.project.status === 'coding') || (status.project.status === 'done' && Boolean(status.project.assembled_video_url));
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
      pipelineLog('remotion-coder', 'stalled-scenes-reopened', { projectId: id, sceneCount: stalled.length });
    })();
  }, [project?.id, project?.status, scenes, busy, setScenes]);

  // The stage note outlives both the banner and the session, so each step
  // points it at what is happening now rather than at the last thing that
  // broke — an image failure from an earlier run otherwise reads as live.
  async function noteStage(projectId: string, stage_note: string) {
    await updateProject(projectId, { stage_note }).catch(() => undefined);
    setProject((live) => live && live.id === projectId ? { ...live, stage_note } : live);
  }

  async function begin(input: Parameters<typeof start>[0]) {
    setBusy(true); setError('');
    try {
      const created = await start(input);
      setView('project');
      pipelineLog('script-llm', 'start', { projectId: created.id, model: settings.script_model, targetLengthSec: input.target_length_sec });
      const result = await writeScript({ topic: input.topic, audience: input.audience, language: input.language, targetLengthSec: input.target_length_sec }, settings.script_model);
      // The same LLM that wrote the script also returned one image brief per
      // beat; those briefs are what the scene planner turns into prompts.
      setImageBriefs(result.scene_image_briefs);
      const next: Partial<Project> = { status: 'script_review', script: result.script, sources: result.sources, estimated_duration_sec: result.estimated_duration_sec };
      await updateProject(created.id, next); setProject({ ...created, ...next });
      pipelineLog('script-llm', 'complete', { projectId: created.id, characters: result.script.length, sourceCount: result.sources.length, estimatedDurationSec: result.estimated_duration_sec });
    } catch (e: any) { pipelineLog('script-llm', 'error', { message: e.message || String(e) }); setError(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function rewrite(direction: string) {
    if (!project) return; setBusy(true); setError('');
    try { pipelineLog('script-llm', 'rewrite-start', { projectId: project.id, model: settings.script_model }); const result = await writeScript({ topic: project.topic, audience: project.audience, language: project.language, targetLengthSec: project.target_length_sec, direction }, settings.script_model); setImageBriefs(result.scene_image_briefs); await patch({ script: result.script, sources: result.sources, estimated_duration_sec: result.estimated_duration_sec }); pipelineLog('script-llm', 'rewrite-complete', { projectId: project.id, characters: result.script.length }); }
    catch (e: any) { pipelineLog('script-llm', 'error', { projectId: project.id, message: e.message }); setError(e.message); } finally { setBusy(false); }
  }

  async function approveScript(script: string) {
    await patch({ script, script_approved_at: new Date().toISOString(), status: 'avatar_render' });
  }

  async function generateAvatar(options: any) {
    if (!project) return; setBusy(true); setError('');
    try {
      pipelineLog('assets', 'audio-video-start', { projectId: project.id, provider: 'heygen', avatarId: options.avatar_id, voiceId: options.voice_id });
      const result = await heygen.generate(project, options);
      const next: Partial<Project> = { heygen_video_id: result.videoId, heygen_video_url: result.videoUrl, avatar_duration_sec: result.duration, word_timestamps: result.words, aspect_ratio: options.aspect_ratio, status: 'style_choice', heygen_chunks: [{ video_id: result.videoId, video_url: result.videoUrl, duration_sec: result.duration }] };
      await updateProject(project.id, next); setProject({ ...project, ...next });
      pipelineLog('assets', 'audio-video-complete', { projectId: project.id, videoId: result.videoId, durationSec: result.duration, timestampCount: result.words.length });
    } catch (e: any) { pipelineLog('assets', 'audio-video-error', { projectId: project.id, message: e.message }); setError(e.message); } finally { setBusy(false); }
  }

  async function confirmStyle() {
    if (!project?.style || !project.script) return; setBusy(true); setError('');
    try {
      await patch({ status: 'scene_planning' });
      const duration = Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec);
      const planned = await decideScenes({ script: project.script, wordTimestamps: project.word_timestamps || [], style: project.style, sceneShare, uploads: [], durationSec: duration, imageBriefs }, settings.scene_decider_model);
      await replaceFromPlan(planned.scenes);
      await patch({ status: 'scene_review' });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function addSceneRange() {
    if (!project) return;
    const duration = Number(project.avatar_duration_sec || project.target_length_sec);
    const persistedScenes = await listScenes(project.id); const currentScenes = persistedScenes.length ? persistedScenes : scenes;
    const last = currentScenes[currentScenes.length - 1]; const startSec = Math.min(duration - 2, Math.max(5, last ? last.script_end_sec + 1 : 6));
    const nextSceneIndex = currentScenes.reduce((highest, scene) => Math.max(highest, scene.scene_index), 0) + 1;
    await add({ project_id: project.id, scene_index: nextSceneIndex, script_start_sec: startSec, script_end_sec: Math.min(duration - 1, startSec + 4), scene_type: 'text_beat', description: 'Describe the supporting visual', image_prompts: ['A clear supporting visual element'], motion_notes: 'Smooth entrance and readable hold', suggested_user_uploads: [], status: 'pending', coding_status: 'pending', approved: false });
  }

  async function uploadScene(scene: Scene, file: File) {
    if (!project) return; setBusy(true);
    // saveUpload's server function already wrote the scene's render_url — it
    // is a server-only column — so this only mirrors the result locally.
    try { const uploaded = await saveUpload(project.id, scene.id, scene.scene_index, file); setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: uploaded.public_url, status: 'ready' as const } : item)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function generateScenePreview(scene: Scene) {
    if (!project || generatingSceneId) return;
    setGeneratingSceneId(scene.id); setSceneImageError('');
    try {
      const made = await generateSceneImage(project, scene, settings.image_model, getStyle(project.style));
      setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: made.url, status: 'ready' as const } : item));
      if (made.fallbackFrom) setSceneImageError(`${made.fallbackFrom} is unavailable right now, so this scene was drawn with ${made.model} instead.`);
    } catch (e: any) {
      setSceneImageError(e.message || 'The selected image model could not generate this scene. Your existing image was kept.');
    } finally { setGeneratingSceneId(null); }
  }

  async function generateAssetsAndCode() {
    if (!project) return; setBusy(true); setError(''); setSceneImageError('');
    try {
      await patch({ status: 'asset_gen' });
      const style = getStyle(project.style);
      setNote('Drawing every scene image, with the shared motion background alongside them');
      pipelineLog('assets', 'start', { projectId: project.id, sceneCount: scenes.length, imageModel: settings.image_model, audioVideoReady: Boolean(project.heygen_video_url) });

      // The motion background runs alongside the stills and is allowed to
      // fail: losing a backdrop texture must not lose the film.
      const motionPromise = ensureMotionBackground(project, style).catch((e: any) => {
        pipelineLog('assets', 'motion-background-skipped', { projectId: project.id, message: e?.message });
        return '';
      });

      // Scenes are drawn a few at a time, each one committed on its own, so a
      // card lights up as soon as its picture lands and one bad prompt cannot
      // take the whole batch down.
      const queue = [...scenes].sort((a, b) => a.scene_index - b.scene_index);
      const failures: string[] = [];
      const lane = async () => {
        for (;;) {
          const scene = queue.shift();
          if (!scene) return;
          setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, status: 'generating' as const } : item));
          try {
            const made = await ensureSceneImage(project, scene, style, settings.image_model);
            setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, render_url: made.url, status: 'ready' as const } : item));
          } catch (e: any) {
            failures.push(`Scene ${scene.scene_index}: ${e?.message || e}`);
            setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, status: 'error' as const } : item));
          }
        }
      };
      await Promise.all([lane(), lane(), lane()]);
      const motionBg = await motionPromise;
      const withImages = await listScenes(project.id);
      const allAssets = await listAssets(project.id);
      setScenes(withImages);
      pipelineLog('assets', 'complete', { projectId: project.id, imageAssetCount: allAssets.length, motionBackgroundReady: Boolean(motionBg), failures: failures.length });
      if (failures.length) throw new Error(`${failures.length} scene image${failures.length === 1 ? '' : 's'} could not be drawn. ${failures[0]}. Retry them on the board, then assemble.`);

      await patch({ status: 'coding', ...(motionBg ? { motion_bg_url: motionBg } : {}) });
      setNote('Writing the motion code for each scene');

      // Scenes still on 'coding' are the wreckage of an earlier attempt, so the
      // pass reopens them before it starts. The stage note is replaced at the
      // same time: it still carries whatever the last failure wrote, and the
      // board shows that old line as if it were happening now.
      const stalled = withImages.filter((scene) => scene.coding_status === 'coding' && !scene.remotion_code);
      for (const scene of stalled) await updateScene(scene.id, { coding_status: 'pending' }, project.id).catch(() => undefined);
      if (stalled.length) setScenes((all) => all.map((item) => stalled.some((row) => row.id === item.id) ? { ...item, coding_status: 'pending' } : item));
      stuckCodingReset.current = project.id;
      await noteStage(project.id, 'Writing motion code…');

      pipelineLog('remotion-coder', 'start', { projectId: project.id, sceneCount: withImages.length, model: settings.coding_model, maxTokensPerScene: SCENE_CODE_MAX_TOKENS, reopenedSceneCount: stalled.length });
      // One scene at a time, one isolated Claude call each, carrying only that
      // scene's own description and motion notes.
      const codingFailures: string[] = [];
      for (const scene of withImages) {
        if (scene.coding_status === 'ready' && scene.remotion_code) continue;
        await updateScene(scene.id, { coding_status: 'coding' }, project.id);
        setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, coding_status: 'coding' } : item));
        try {
          const coded = await codeScene(scene, { aspectRatio: project.aspect_ratio, styleMotion: style.componentTemplate, model: settings.coding_model });
          const sceneAssets = allAssets.filter((asset) => asset.scene_id === scene.id);
          let renderUrl = scene.render_url || sceneAssets[0]?.public_url || '';
          // A failed scene render keeps the still instead of failing the run; the
          // timeline reads the URL itself to decide whether it is video.
          if (project.aspect_ratio === '16:9') {
            try { renderUrl = await renderScene(coded.code, scene, sceneAssets, motionBg); }
            catch (e: any) { pipelineLog('remotion-coder', 'scene-render-skipped', { projectId: project.id, sceneIndex: scene.scene_index, message: e?.message }); }
          }
          await updateScene(scene.id, { remotion_code: coded.code, render_url: renderUrl, coding_status: 'ready', status: 'ready' }, project.id);
          setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, remotion_code: coded.code, render_url: renderUrl, coding_status: 'ready', status: 'ready' as const } : item));
          pipelineLog('remotion-coder', 'scene-complete', { projectId: project.id, sceneIndex: scene.scene_index });
        } catch (e: any) {
          // One scene's failure is that scene's failure. It is marked so the
          // board can say so, and the pass keeps going instead of throwing away
          // the scenes that would have worked.
          const why = String(e?.message || e);
          codingFailures.push(`Scene ${scene.scene_index}: ${why}`);
          await updateScene(scene.id, { coding_status: 'error' }, project.id).catch(() => undefined);
          setScenes((all) => all.map((item) => item.id === scene.id ? { ...item, coding_status: 'error' } : item));
          pipelineLog('remotion-coder', 'scene-error', { projectId: project.id, sceneIndex: scene.scene_index, message: why });
        }
      }
      pipelineLog('remotion-coder', 'complete', { projectId: project.id, codedSceneCount: withImages.length - codingFailures.length, failedSceneCount: codingFailures.length, nextStage: 'joiner' });
      if (codingFailures.length) {
        const plural = codingFailures.length === 1 ? '' : 's';
        await noteStage(project.id, `${codingFailures.length} scene${plural} still need motion code`);
        throw new Error(`${codingFailures.length} scene${plural} could not get motion code. ${codingFailures[0]}. Use “Generate the remaining scenes” to retry just those.`);
      }
      const readyNote = 'Every scene has a picture and its code — ready to assemble';
      setNote(readyNote);
      await noteStage(project.id, readyNote);
    } catch (e: any) { pipelineLog('assets', 'or-coder-error', { projectId: project.id, message: e.message }); setError(e.message); } finally { setBusy(false); }
  }

  // ElevenLabs music bed, then the mix that lays it under the picture.
  async function makeMusic(prompt: string) {
    if (!project) return; setMusicBusy(true); setMusicNote('');
    try {
      const seconds = Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec) || 30;
      const result = await forgeApi.music(project.id, prompt || undefined, seconds);
      setProject((current) => current ? { ...current, music_url: result.musicUrl, music_prompt: result.prompt } : current);
      setMusicNote('Music bed ready — preview it below, then mix it into the film.');
    } catch (e: any) { setMusicNote(e.message || String(e)); } finally { setMusicBusy(false); }
  }

  async function mixMusic() {
    if (!project) return; setMusicBusy(true); setMusicNote('Mixing the music bed under the film…');
    try {
      let result = await forgeApi.mixMusic(project.id);
      for (let i = 0; i < 60 && result.pending; i += 1) { await sleep(5000); result = await forgeApi.mixStatus(project.id); }
      if (result.finalUrl) { const url = result.finalUrl; setProject((current) => current ? { ...current, final_video_url: url } : current); }
      setMusicNote(result.note || (result.mixed ? 'The final master now carries the music bed.' : 'Still mixing — reopen this project in a moment to pick it up.'));
    } catch (e: any) { setMusicNote(e.message || String(e)); } finally { setMusicBusy(false); }
  }

  async function assemble() {
    // A second click while a render is in flight would start a parallel render
    // and leave two operations writing the same project.
    if (!project || assembling.current) return;
    if (!project.heygen_video_url) { setError('This project has no avatar master yet, so there is nothing to assemble against.'); return; }
    const current = project; const projectId = current.id;
    const mergeProject = (changes: Partial<Project>) => setProject((live) => live && live.id === projectId ? { ...live, ...changes } : live);
    assembling.current = true;
    setBusy(true); setError(''); setNote('Building the final timeline');
    try {
      pipelineLog('joiner', 'start', { projectId, sceneCount: scenes.length, scriptReady: Boolean(current.script), audioVideoReady: Boolean(current.heygen_video_url) });
      // A retry starts from a clean slate: the previous attempt's checks and
      // failure note are not this attempt's verdict.
      const opening: Partial<Project> = { status: 'assembling', checks: [], stage_note: 'Building the final timeline' };
      await updateProject(projectId, opening); mergeProject(opening);
      const assets = await listAssets(projectId); const timeline = buildTimeline(current, scenes, assets); let videoUrl = '';
      if (!timeline.length) throw new Error('The timeline came out empty. Approve at least one scene — or re-record the avatar so its duration is known — then assemble again.');
      // The render length comes from the timeline itself, so a scene that runs
      // past the recorded avatar duration is not cut off and a project with no
      // duration at all still renders instead of being rejected.
      const durationInFrames = timelineDurationInFrames(timeline, Number(current.avatar_duration_sec || current.estimated_duration_sec || current.target_length_sec) || 0);
      pipelineLog('joiner', 'timeline-ready', { projectId, segmentCount: timeline.length, codedSceneRenders: timeline.filter((segment) => segment.sceneRenderKind === 'video').length, assetCount: assets.length, durationInFrames });
      if (current.aspect_ratio === '9:16') {
        setNote('Compositing native 1080 by 1920 full-frame scenes while preserving avatar audio');
        // A coded scene render is a video and cannot be overlaid as a still, so
        // the portrait path prefers the scene's own picture and falls back to
        // its generated asset.
        const overlays = timeline.filter((segment) => segment.type === 'scene').map((segment) => ({ asset_url: (segment.sceneRenderKind === 'image' ? segment.sceneRenderUrl : undefined) || segment.assetUrls?.[0], start_time: segment.startSec, end_time: segment.startSec + segment.frames / 30, position: 'full' })).filter((row) => row.asset_url);
        if (!overlays.length) throw new Error('No scene picture was ready to composite over the avatar. Generate the scene images, then assemble again.');
        const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/videos/overlay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() }, body: JSON.stringify({ base_video_url: current.heygen_video_url, overlays, dimensions: { width: 1080, height: 1920 }, output_format: 'mp4', duration_seconds: current.avatar_duration_sec }) });
        const data = await response.json().catch(() => ({})); if (!response.ok || !data.overlayUrl) throw new Error(data.error || 'Portrait assembly failed'); videoUrl = data.overlayUrl;
      } else {
        const submitRender = async () => {
          const response = await fetch('/api/render/remotion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: WORKSPACE_ID, compositionTsx: createAssemblySource(durationInFrames), props: { timeline, avatarVideoUrl: current.heygen_video_url, motionBgUrl: current.motion_bg_url }, durationInFrames }) });
          const started = await response.json().catch(() => ({})); if (!response.ok || !started.operationId) throw new Error(started.error || 'Assembly render could not start');
          const rendering: Partial<Project> = { render_operation_id: String(started.operationId), stage_note: 'Rendering the Remotion assembly' };
          await updateProject(projectId, rendering).catch(() => undefined); mergeProject(rendering);
          for (let i = 0; i < 300; i += 1) {
            await sleep(2000);
            // A dropped poll is not a failed render — the next tick asks again.
            const status = await fetch(`/api/render/remotion/${encodeURIComponent(started.operationId)}`).then((r) => r.json()).catch(() => null);
            if (!status) continue;
            if (status.status === 'complete' && status.videoUrl) return String(status.videoUrl);
            if (status.status === 'failed') throw new Error(status.error || 'Assembly failed');
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
      const previousHash = current.build_hash; const hash = `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
      const editorManifest = { version: 2, avatarVideoUrl: current.heygen_video_url, scenes: scenes.map((scene) => ({ ...scene, assets: assets.filter((asset) => asset.scene_id === scene.id) })), timeline };
      const next = { ...current, assembled_video_url: videoUrl, build_hash: hash, editor_manifest: editorManifest, status: 'checks' as const };
      await updateProject(projectId, { assembled_video_url: videoUrl, build_hash: hash, editor_manifest: editorManifest, status: 'checks', render_operation_id: null, stage_note: 'Running the six delivery checks' });
      const checks = await runChecks(next, scenes, assets, previousHash); const finalStatus = checks.every((check) => check.pass) ? 'done' : 'checks';
      const stageNote = finalStatus === 'done' ? 'Film assembled and all six checks passed' : 'Film assembled — some checks still need attention';
      await updateProject(projectId, { checks, status: finalStatus, stage_note: stageNote });
      mergeProject({ ...next, checks, status: finalStatus, stage_note: stageNote });
      pipelineLog('joiner', 'complete', { projectId, videoUrlReady: Boolean(videoUrl), checksPassed: checks.filter((check) => check.pass).length, checkCount: checks.length, finalStatus });
    } catch (e: any) {
      const why = String(e?.message || e);
      pipelineLog('joiner', 'error', { projectId, message: why });
      setError(why);
      // Park the reason on the project so Step 7 can explain the failure and
      // offer the retry even after a reload, and leave the status somewhere
      // that is not "forever assembling".
      const failed: Partial<Project> = { status: 'checks', checks: [], stage_note: `${ASSEMBLY_FAILED_PREFIX} ${why}`.slice(0, 480), render_operation_id: null };
      await updateProject(projectId, failed).catch(() => undefined); mergeProject(failed);
    } finally { assembling.current = false; setBusy(false); setNote(''); }
  }

  function openEditor() {
    if (!project?.assembled_video_url) return;
    const payload = { url: project.assembled_video_url, title: project.topic, mode: 'edit', manifest: project.editor_manifest, ts: Date.now() };
    localStorage.setItem('sceneforge_handoff_v1', JSON.stringify(payload)); localStorage.setItem('sceneforge_editor_manifest_v2', JSON.stringify(payload));
    void patch({ status: 'editing' }); window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'video-enhancer' } }));
  }

  async function askVerger() {
    if (!project || !vergerText.trim()) return; setBusy(true); setVergerReply('');
    try {
      const request = vergerText.trim(); const routed = await routeVergerRequest(request, { project, scenes }); const editing = project.status === 'scene_review';
      await (window as any).__workspaceDb.from('verger_requests').insert({ project_id: project.id, request_text: request, route: routed.route, action_taken: routed.action, status: editing && routed.route === 'scene' ? 'queued' : 'applied', queued_until_user_save: editing && routed.route === 'scene' });
      if (editing && routed.route === 'scene') setVergerReply('I queued that scene change and will apply it after you finish the active scene edits.');
      else if (routed.route === 'script') { await rewrite(request); setVergerReply('I sent the script change to the Script agent. Review the updated draft.'); }
      else if (routed.route === 'style') { await patch({ status: 'style_choice' }); setVergerReply('I routed this to the style system. Choose or confirm the new treatment.'); }
      else if (routed.route === 'scene') { await patch({ status: 'scene_planning' }); const duration = Number(project.avatar_duration_sec || project.target_length_sec); const planned = await decideScenes({ script: project.script || '', wordTimestamps: project.word_timestamps || [], style: project.style || 'vox-explainer', sceneShare, uploads: [], durationSec: duration }, settings.scene_decider_model); await replaceFromPlan(planned.scenes); await patch({ status: 'scene_review' }); setVergerReply('I replanned the affected visual range. Review and approve the scenes.'); }
      else { await assemble(); setVergerReply('I routed the request to assembly and rebuilt the final timeline.'); }
      setVergerText('');
    } catch (e: any) { setVergerReply(e.message); } finally { setBusy(false); }
  }

  const content = () => {
    if (view === 'settings') return <SettingsPanel />;
    if (view === 'library') return <Library projects={projects} loading={loading} onOpen={(id) => { void open(id); setView('project'); }} onNew={() => { setProject(null); setView('project'); }} />;
    if (!project) return <TopicInput busy={busy} onStart={(input) => void begin(input)} />;
    if (project.status === 'scripting') return <Working text="Researching and writing your script" />;
    if (project.status === 'script_review') return <ScriptReview key={project.script} initialScript={project.script || ''} sources={project.sources || []} busy={busy} onApprove={(script) => void approveScript(script)} onRewrite={(direction) => void rewrite(direction)} />;
    if (project.status === 'avatar_render') return <HeyGenModule avatars={heygen.avatars} voices={heygen.voices} aspectRatio={project.aspect_ratio} progress={heygen.progress} busy={busy} videoUrl={project.heygen_video_url} onGenerate={(options) => void generateAvatar(options)} />;
    if (project.status === 'style_choice') return <StylePicker value={project.style} onChange={(style) => void patch({ style })} onConfirm={() => void confirmStyle()} />;
    if (project.status === 'scene_planning') return <Working text="Verger is timing supporting scenes against the avatar" />;
    if (project.status === 'scene_review') return <ScenePlanner scenes={scenes} duration={Number(project.avatar_duration_sec || project.target_length_sec)} share={sceneShare} onShare={setSceneShare} imageModel={settings.image_model} onImageModel={(image_model) => setSettings((old) => ({ ...old, image_model }))} onPatch={(id, value) => void patchScene(id, value)} onRemove={(id) => void remove(id)} onAdd={() => void addSceneRange()} onUpload={(scene, file) => void uploadScene(scene, file)} onGenerateImage={(scene) => void generateScenePreview(scene)} generatingSceneId={generatingSceneId} onGenerate={() => void generateAssetsAndCode()} />;
    const board = <AssetProgress scenes={scenes} busy={busy} note={note} project={project} onAssemble={() => void assemble()} onRetryScene={(scene) => void generateScenePreview(scene)} onResume={() => void generateAssetsAndCode()} />;
    if (project.status === 'asset_gen' || project.status === 'coding') return board;
    if (project.status === 'assembling' || project.status === 'checks' || project.status === 'done') {
      // A run that was interrupted before it produced a film lands back on the
      // board it stopped on, with what it already made, instead of on an empty
      // player it can never fill.
      const stalled = !busy && !project.assembled_video_url && scenes.some((scene) => !scene.render_url || scene.coding_status !== 'ready');
      if (stalled) return board;
      // The persisted note survives a reload, so it is the primary source for
      // "this render failed, and here is why"; the live error covers the
      // attempt that just happened in front of the customer.
      const noted = String(project.stage_note || '');
      const failure = busy || project.assembled_video_url ? '' : noted.startsWith(ASSEMBLY_FAILED_PREFIX) ? noted.slice(ASSEMBLY_FAILED_PREFIX.length).trim() : error;
      return <AssemblyProgress busy={busy} note={note} failure={failure} project={project} checks={project.checks || []} musicBusy={musicBusy} musicNote={musicNote} onRetry={() => void assemble()} onContinue={openEditor} onGenerateMusic={(value) => void makeMusic(value)} onMixMusic={() => void mixMusic()} />;
    }
    if (project.status === 'editing') return <EditorHandoff project={project} scenes={scenes} onOpen={openEditor} />;
    return <Working text="Restoring this project" />;
  };

  return <div className="relative flex h-full min-h-[560px] flex-col overflow-hidden bg-[var(--space-surface-bg)] text-[var(--space-text-primary)]">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-5"><button onClick={() => { setView('library'); setProject(null); void refreshLibrary(); }} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 font-bold tracking-tight transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--space-brand-primary-600)] shadow-[0_2px_10px_color-mix(in_srgb,var(--space-brand-primary-600)_45%,transparent)]"><Film className="h-5 w-5 text-white" /></span>SceneForge</button><span className="hidden text-sm text-[var(--space-text-muted)] sm:block">Avatar-first explainers, directed scene by scene</span><div className="ml-auto flex gap-2"><button onClick={() => setVergerOpen(true)} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-sm font-medium transition-all hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><MessageSquareText className="h-4 w-4" />Verger</button><button aria-label="Settings" onClick={() => setView('settings')} className="rounded-xl border border-[var(--space-border-default)] p-2 transition-all hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><Settings className="h-4 w-4" /></button></div></header>
    {error ? <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--space-semantic-danger-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_14%,transparent)] px-5 py-2.5 text-sm leading-relaxed text-[var(--space-semantic-danger)]"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')} className="shrink-0 rounded-lg p-1 transition-colors hover:bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_18%,transparent)]"><X className="h-4 w-4" /></button></div> : null}
    <main className="flex-1 overflow-y-auto">{content()}</main>
    {sceneImageError ? <div role="alert" className="absolute bottom-5 right-5 z-30 flex max-w-sm items-start gap-3 rounded-xl border border-[var(--space-semantic-danger)] bg-[var(--space-surface-card)] p-4 text-sm text-[var(--space-text-primary)] shadow-2xl"><span>{sceneImageError}</span><button aria-label="Dismiss image generation error" onClick={() => setSceneImageError('')}><X className="h-4 w-4" /></button></div> : null}
    {vergerOpen ? <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold tracking-tight">Verger</h2><p className="mt-0.5 text-xs text-[var(--space-text-muted)]">Coordinator · routes only what you ask</p></div><button aria-label="Close Verger" onClick={() => setVergerOpen(false)} className="rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><X className="h-5 w-5" /></button></div><div className="mt-6 flex-1 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-4 text-sm leading-relaxed text-[var(--space-text-secondary)]">{vergerReply || 'Try “make scene 3 a pie chart”, “redo the script intro”, or “switch everything to documentary”. Active scene edits are queued, never overwritten.'}</div><textarea value={vergerText} onChange={(e) => setVergerText(e.target.value)} rows={4} placeholder="Tell Verger what to change…" className="mt-4 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-[var(--space-text-primary)] transition-colors placeholder:text-[var(--space-text-muted)] focus:border-[var(--space-brand-primary-500)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--space-brand-primary-500)_25%,transparent)]" /><button disabled={busy || !project || !vergerText.trim()} onClick={() => void askVerger()} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_4px_16px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40 disabled:shadow-none">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send to Verger</button></aside> : null}
  </div>;
}

function Working({ text }: { text: string }) { return <div className="flex h-full min-h-[420px] items-center justify-center"><div className="text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--space-text-brand)]" /><p className="mt-4 text-[var(--space-text-secondary)]">{text}…</p></div></div>; }
function Library({ projects, loading, onOpen, onNew }: { projects: Project[]; loading: boolean; onOpen: (id: string) => void; onNew: () => void }) { return <div className="mx-auto max-w-6xl px-6 py-10"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Your studio</p><h1 className="mt-2 text-3xl font-bold tracking-tight">SceneForge projects</h1></div><button onClick={onNew} className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)]"><Plus className="h-4 w-4" />New project</button></div>{loading ? <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]" />)}</div> : <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <button key={project.id} onClick={() => onOpen(project.id)} className="group rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--space-border-strong)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><FolderOpen className="h-5 w-5 text-[var(--space-text-brand)] transition-transform group-hover:scale-110" /><div className="mt-4 line-clamp-2 font-semibold leading-snug">{project.topic}</div><div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--space-text-muted)]">{project.status.replace(/_/g, ' ')} · {project.aspect_ratio}</div></button>)}{!projects.length ? <div className="col-span-full flex flex-col items-center rounded-2xl border border-dashed border-[var(--space-border-default)] px-8 py-14 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent)]"><Film className="h-6 w-6 text-[var(--space-text-brand)]" /></span><p className="mt-4 text-lg font-semibold text-[var(--space-text-primary)]">Direct your first explainer</p><p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--space-text-muted)]">Give SceneForge a topic — it researches the script, renders your avatar, and builds every supporting scene.</p><button onClick={onNew} className="mt-6 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-2.5 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)]"><Plus className="h-4 w-4" />Start a project</button></div> : null}</div>}</div>; }
