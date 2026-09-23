import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Copy, Eye, GitBranch, Image, Loader2, Plus, Scissors, Trash2, Type, Upload, Video, Volume2, VolumeX, X } from 'lucide-react';
import { IMAGE_MODELS } from '../lib/imageTool';
import { AVATAR_SAFE_POSITIONS, COMPOSITION_MODES, EFFECT_PRESETS, KIND_COLORS, KIND_LABELS, MEDIA_LAYOUTS, OVERLAY_POSITIONS, OVERLAY_SIZES, TEXT_ANIMATIONS, defaultOverlay, effectPresetMeta, effectiveComposition, normalizeEffect, visualKindOf, type CompositionPosition, type CompositionSpec, type EffectSetting, type MediaLayout, type OverlayConfig, type VisualKind } from '../lib/effects';
import { isVideoUrl } from '../lib/sceneState';
import { hasFreshMotionClip, portraitPlacement, sceneDirection, sceneMotionDuration, sceneMotionSpec } from '../lib/motionCapture';
import { MOTION_KINDS, normalizeMotionSpec, type MotionItem, type MotionSpec } from '../lib/motionSpec';
import MotionGraphicPlayer from './MotionGraphicPlayer';
import { getProject, type Asset, type Scene } from '../lib/supabase';
import { forgeApi } from '../lib/forge';

interface Props {
  scenes: Scene[];
  assets: Asset[];
  duration: number;
  aspect: '16:9' | '9:16';
  share: 'low' | 'medium' | 'high';
  onShare: (value: 'low' | 'medium' | 'high') => void;
  imageModel: string;
  onImageModel: (value: string) => void;
  onPatch: (id: string, patch: Partial<Scene>) => void;
  onKind: (scene: Scene, kind: VisualKind) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onUpload: (scene: Scene, file: File) => void;
  onGenerateImage: (scene: Scene) => void;
  onGenerateVideo: (scene: Scene) => void;
  onGenerateMotion: (scene: Scene) => void;
  generatingSceneId?: string | null;
  onGenerate: () => void;
}

const inputClass = 'rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-2.5 text-sm text-[var(--space-text-primary)] outline-none transition-colors focus:border-[var(--space-brand-primary-500)]';

// LIVE PRESET PREVIEW — a CSS approximation of each assembly effect so every
// preset shows a real, visible animation right in the editor (the final
// render's deterministic interpretation lives in remotion/AssemblyComp).
const PREVIEW_ANIMS: Record<string, string> = {
  zoom_in: 'sfZoomIn 4s ease-in-out infinite alternate',
  zoom_out: 'sfZoomOut 4s ease-in-out infinite alternate',
  pan_left: 'sfPanLeft 4s linear infinite alternate',
  pan_right: 'sfPanRight 4s linear infinite alternate',
  parallax: 'sfParallax 4.5s ease-in-out infinite alternate',
  ken_burns: 'sfKenBurns 5s ease-in-out infinite alternate',
  fade: 'sfFade 3.5s ease-in-out infinite',
  blur_reveal: 'sfBlurReveal 3.5s ease-out infinite',
  scale_up: 'sfScaleUp 3s ease-out infinite',
  scale_down: 'sfScaleDown 3s ease-out infinite',
  float: 'sfFloat 3.6s ease-in-out infinite',
  push_in: 'sfPushIn 3.2s ease-out infinite',
  push_out: 'sfPushOut 3.2s ease-in infinite',
};
const PREVIEW_KEYFRAMES = `
@keyframes sfZoomIn{from{transform:scale(1)}to{transform:scale(1.14)}}
@keyframes sfZoomOut{from{transform:scale(1.14)}to{transform:scale(1)}}
@keyframes sfPanLeft{from{transform:scale(1.08) translateX(3.5%)}to{transform:scale(1.08) translateX(-3.5%)}}
@keyframes sfPanRight{from{transform:scale(1.08) translateX(-3.5%)}to{transform:scale(1.08) translateX(3.5%)}}
@keyframes sfParallax{from{transform:scale(1.06) translate(2.5%,1%)}to{transform:scale(1.06) translate(-2.5%,-1%)}}
@keyframes sfKenBurns{from{transform:scale(1.05)}to{transform:scale(1.15) translate(2.5%,2.5%)}}
@keyframes sfFade{0%{opacity:0}22%{opacity:1}78%{opacity:1}100%{opacity:0}}
@keyframes sfBlurReveal{0%{filter:blur(12px)}40%{filter:blur(0)}100%{filter:blur(0)}}
@keyframes sfScaleUp{0%{transform:scale(.9)}35%{transform:scale(1.02)}45%{transform:scale(1)}100%{transform:scale(1)}}
@keyframes sfScaleDown{0%{transform:scale(1.12)}35%{transform:scale(1)}100%{transform:scale(1)}}
@keyframes sfFloat{0%,100%{transform:translateY(0) scale(1.03)}50%{transform:translateY(-8px) scale(1.03)}}
@keyframes sfPushIn{0%{transform:translateX(-30%)}28%{transform:translateX(0)}100%{transform:translateX(0)}}
@keyframes sfPushOut{0%{transform:translateX(0)}72%{transform:translateX(0)}100%{transform:translateX(30%)}}
@keyframes sfSweep{0%{transform:translateX(-160%) rotate(14deg)}100%{transform:translateX(260%) rotate(14deg)}}
`;

const KIND_CHOICES: { id: VisualKind; icon: typeof Clapperboard; hint: string }[] = [
  { id: 'ai_video', icon: Clapperboard, hint: 'Real generated footage — places, actions, cinematic motion' },
  { id: 'motion_graphic', icon: GitBranch, hint: 'GSAP diagram / chart / timeline — exact text, captured to a clip' },
  { id: 'image', icon: Image, hint: 'One strong still for the window' },
  { id: 'text_overlay', icon: Type, hint: 'A deterministic animated headline, captured to a clip' },
];

function itemsToText(items: MotionItem[]): string {
  return (items || []).map((item) => [item.label, item.sublabel, item.value].filter((part) => part !== undefined && part !== '').join(' | ')).join('\n');
}
function parseItemsText(text: string): MotionItem[] {
  return text.split('\n').map((line) => {
    const [label, sublabel, value] = line.split('|').map((part) => part.trim());
    if (!label) return null;
    const item: MotionItem = { label };
    if (sublabel) item.sublabel = sublabel;
    const n = Number(value !== undefined ? value : sublabel);
    if (value !== undefined && Number.isFinite(n)) item.value = n;
    else if (sublabel && value === undefined && Number.isFinite(Number(sublabel))) { item.value = Number(sublabel); delete item.sublabel; }
    return item;
  }).filter(Boolean).slice(0, 8) as MotionItem[];
}

const COMPOSITION_OVERLAY_POSITIONS: CompositionPosition[] = ['lower_third', 'left', 'right', 'top_left', 'top_right', 'bottom_left', 'bottom_right'];

/** Per-scene composition editor: overlay / central / fullscreen plus position and size. */
function CompositionControls({ comp, onChange }: { comp: CompositionSpec; onChange: (changes: Partial<CompositionSpec>) => void }) {
  return <div className="mt-3 rounded-lg bg-[var(--space-surface-card)] p-3">
    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Composition — how this visual sits against the presenter</label>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {COMPOSITION_MODES.map((mode) => { const active = comp.mode === mode.id; return <button key={mode.id} type="button" title={mode.detail} onClick={() => onChange({ mode: mode.id, keepAvatarVisible: mode.id !== 'fullscreen' })} className={active ? 'rounded-lg border border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_14%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--space-text-primary)]' : 'rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)]'}>{mode.label}</button>; })}
      {comp.mode === 'overlay' ? <select value={COMPOSITION_OVERLAY_POSITIONS.includes((comp.position || 'lower_third') as CompositionPosition) ? comp.position || 'lower_third' : 'lower_third'} onChange={(e) => onChange({ position: e.target.value as CompositionPosition })} className={inputClass} aria-label="Overlay position">{COMPOSITION_OVERLAY_POSITIONS.map((position) => <option key={position} value={position}>{position.replace(/_/g, ' ')}</option>)}</select> : null}
      {comp.mode !== 'fullscreen' ? <label className="flex items-center gap-2 text-xs text-[var(--space-text-secondary)]">Size<input type="range" min={0.3} max={0.94} step={0.02} value={comp.scale || (comp.mode === 'central' ? 0.88 : 0.58)} onChange={(e) => onChange({ scale: Number(e.target.value) })} /></label> : null}
    </div>
    <p className="mt-2 text-[11px] text-[var(--space-text-muted)]">{comp.mode === 'fullscreen' ? 'Cutaway — the visual temporarily replaces the presenter, then the film returns to them.' : comp.mode === 'central' ? 'The visual dominates the frame while the presenter stays partially visible behind it.' : 'The presenter stays fully on screen; the visual rides a face-safe zone with a transparent background.'}{comp.purpose ? ` · Why: ${comp.purpose}` : ''}</p>
  </div>;
}

export default function ScenePlanner(props: Props) {
  const { scenes, assets, duration, aspect, share, onShare, imageModel, onImageModel, onPatch, onKind, onRemove, onAdd, onUpload, onGenerateImage, onGenerateVideo, onGenerateMotion, generatingSceneId, onGenerate } = props;
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [previewOnVideo, setPreviewOnVideo] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [timelineRevision, setTimelineRevision] = useState(0);
  const [timelineBusy, setTimelineBusy] = useState<string | null>(null);
  const [mixedMusicUrl, setMixedMusicUrl] = useState('');
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const previewScene = scenes.find((scene) => scene.id === previewSceneId) || null;
  const approved = scenes.filter((scene) => scene.approved).length;
  const pickableAssets = assets.filter((asset) => asset.public_url && (asset.asset_type === 'scene_image' || asset.asset_type === 'user_upload'));
  void timelineRevision;

  useEffect(() => {
    const projectId = scenes[0]?.project_id;
    if (!projectId) { setMixedMusicUrl(''); return; }
    let live = true;
    void getProject(projectId).then((project) => { if (live) { setMixedMusicUrl(project?.final_video_url && project.music_url ? project.music_url : ''); setAvatarUrl(project?.heygen_video_url || ''); } });
    const focus = sessionStorage.getItem('sceneforge-focus-scene');
    if (focus) { sessionStorage.removeItem('sceneforge-focus-scene'); requestAnimationFrame(() => document.getElementById(`sceneforge-scene-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }
    return () => { live = false; };
  }, [scenes[0]?.project_id, scenes.length]);

  const syncScenes = (next: Scene[]) => { window.dispatchEvent(new CustomEvent('sceneforge:scenes-changed', { detail: { projectId: next[0]?.project_id || scenes[0]?.project_id, scenes: next } })); setTimelineRevision((value) => value + 1); };
  const duplicateScene = async (scene: Scene) => {
    setTimelineBusy(scene.id);
    try {
      const { id: _id, ...copy } = scene;
      const result = await forgeApi.addScene(scene.project_id, { ...copy, approved: false, status: 'pending', coding_status: 'pending', user_locked_fields: ['script_start_sec', 'script_end_sec', 'scene_type', 'description', 'image_prompts', 'motion_notes', 'visual_kind', 'overlay_config', 'video_prompt', 'spec', 'audio_muted', 'audio_volume'] });
      syncScenes(result.scenes);
    } finally { setTimelineBusy(null); }
  };
  const splitScene = async (scene: Scene) => {
    const midpoint = Math.round(((Number(scene.script_start_sec) + Number(scene.script_end_sec)) / 2) * 10) / 10;
    if (midpoint - Number(scene.script_start_sec) < 0.25 || Number(scene.script_end_sec) - midpoint < 0.25) return;
    setTimelineBusy(scene.id);
    try {
      await forgeApi.saveScene(scene.project_id, scene.id, { script_end_sec: midpoint });
      const { id: _id, ...copy } = scene;
      const result = await forgeApi.addScene(scene.project_id, { ...copy, script_start_sec: midpoint, script_end_sec: scene.script_end_sec, approved: false, status: 'pending', coding_status: 'pending', user_locked_fields: ['script_start_sec', 'script_end_sec', 'scene_type', 'description', 'image_prompts', 'motion_notes', 'visual_kind', 'overlay_config', 'video_prompt', 'spec', 'audio_muted', 'audio_volume'] });
      syncScenes(result.scenes.map((row) => row.id === scene.id ? { ...row, script_end_sec: midpoint } : row));
    } finally { setTimelineBusy(null); }
  };
  const beginRetime = (event: React.PointerEvent, scene: Scene, mode: 'move' | 'start' | 'end') => {
    event.preventDefault(); event.stopPropagation();
    const rect = timelineRef.current?.getBoundingClientRect(); if (!rect || duration <= 0) return;
    const originX = event.clientX; const originalStart = Number(scene.script_start_sec); const originalEnd = Number(scene.script_end_sec); const length = originalEnd - originalStart;
    const move = (pointer: PointerEvent) => {
      const delta = ((pointer.clientX - originX) / rect.width) * duration;
      if (mode === 'move') { const start = Math.max(5, Math.min(duration - 1 - length, originalStart + delta)); scene.script_start_sec = Math.round(start * 10) / 10; scene.script_end_sec = Math.round((start + length) * 10) / 10; }
      if (mode === 'start') scene.script_start_sec = Math.round(Math.max(5, Math.min(originalEnd - 0.25, originalStart + delta)) * 10) / 10;
      if (mode === 'end') scene.script_end_sec = Math.round(Math.min(duration - 1, Math.max(originalStart + 0.25, originalEnd + delta)) * 10) / 10;
      setTimelineRevision((value) => value + 1);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); void onPatch(scene.id, { script_start_sec: scene.script_start_sec, script_end_sec: scene.script_end_sec }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  };
  const retryWeakScene = (scene: Scene) => {
    void onPatch(scene.id, { qc_weak: false, qc_suggestion: null });
    const kind = visualKindOf(scene.visual_kind);
    if (kind === 'ai_video') onGenerateVideo(scene);
    else if (kind === 'motion_graphic' || kind === 'text_overlay') onGenerateMotion(scene);
    else onGenerateImage(scene);
  };
  useEffect(() => {
    if (generatingSceneId) return;
    const requested = sessionStorage.getItem('sceneforge-auto-regenerate-scene');
    if (!requested) return;
    const scene = scenes.find((item) => item.scene_index === Number(requested));
    if (!scene) return;
    sessionStorage.removeItem('sceneforge-auto-regenerate-scene');
    const timer = window.setTimeout(() => { document.getElementById(`sceneforge-scene-${requested}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); retryWeakScene(scene); }, 120);
    return () => window.clearTimeout(timer);
  }, [scenes.length, generatingSceneId]);

  const overlayOf = (scene: Scene): OverlayConfig => scene.overlay_config || defaultOverlay(scene.description);
  const patchOverlay = (scene: Scene, changes: Partial<OverlayConfig>) => onPatch(scene.id, { overlay_config: { ...overlayOf(scene), ...changes } });
  const patchEffect = (scene: Scene, changes: Partial<EffectSetting>) => {
    const current = normalizeEffect(overlayOf(scene).effect);
    patchOverlay(scene, { effect: normalizeEffect({ ...current, ...changes }) });
  };
  const specOf = (scene: Scene): MotionSpec => normalizeMotionSpec(scene.spec || {}, scene.description);
  const patchSpec = (scene: Scene, changes: Partial<MotionSpec>) => onPatch(scene.id, { spec: { ...specOf(scene), ...changes } as any });
  // The composition a scene renders with: the plan's explicit decision, or the
  // kind-aware default (compact graphics → overlay, structural diagrams →
  // central, everything else → fullscreen takeover).
  const compositionOf = (scene: Scene): CompositionSpec => {
    const kind = visualKindOf(scene.visual_kind);
    const motionKind = kind === 'motion_graphic' || kind === 'text_overlay' ? specOf(scene).kind : null;
    return effectiveComposition(kind, overlayOf(scene), motionKind) || { mode: 'fullscreen', keepAvatarVisible: false };
  };
  const patchComposition = (scene: Scene, changes: Partial<CompositionSpec>) => patchOverlay(scene, { composition: { ...compositionOf(scene), ...changes } });
  // Where the composited visual sits inside the preview frame — mirrors
  // portraitPlacement (9:16 FFmpeg composite) and the Remotion card frame
  // (16:9), so "preview on video" shows the real final position.
  const previewRectStyle = (comp: CompositionSpec): React.CSSProperties => {
    if (aspect === '9:16') {
      const rect = portraitPlacement(comp, { tall: true });
      return { position: 'absolute', left: `${(rect.x / 1080) * 100}%`, top: `${(rect.y / 1920) * 100}%`, width: `${(rect.w / 1080) * 100}%`, height: `${(rect.h / 1920) * 100}%` };
    }
    if (comp.mode === 'central') { const w = Math.min(0.8, Math.max(0.5, comp.scale || 0.62)); return { position: 'absolute', left: `${((1 - w) / 2) * 100}%`, top: '16%', width: `${w * 100}%`, aspectRatio: '16 / 9' }; }
    const w = Math.min(0.5, Math.max(0.22, comp.scale || 0.34));
    const pos = comp.position || 'lower_third';
    const style: React.CSSProperties = { position: 'absolute', width: `${w * 100}%`, aspectRatio: '16 / 9' };
    if (pos.includes('left')) style.left = '4%'; else style.right = '4%';
    if (pos.startsWith('top')) style.top = '7%'; else style.bottom = '9%';
    return style;
  };

  return <div className="mx-auto max-w-6xl px-6 py-9">
    <style>{PREVIEW_KEYFRAMES}</style>
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 5 · Video blueprint</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">Talking head, cut with middle visuals</h1>
    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--space-text-secondary)]">Your presenter carries the film and their narration never stops. Each middle scene is <strong>composited around the presenter</strong> — small stats and callouts ride over them as transparent overlays, diagrams take a central panel while they stay visible, and only cinematic beats cut away full-screen. Choose <strong>AI Video</strong> for real footage, <strong>Motion Graphic</strong> for diagrams, timelines, charts and exact text, <strong>Image</strong> for a strong still, or <strong>Text Overlay</strong> for an animated headline; the composition mode on each scene decides how it sits against the presenter.</p>
    <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="mb-3 flex items-center justify-between text-sm text-[var(--space-text-secondary)]"><span>Timeline · {duration.toFixed(1)} seconds</span><span>{approved} of {scenes.length} approved</span></div>
      <div ref={timelineRef} className="overflow-x-auto rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] p-2 select-none">
        <div className="grid min-w-[760px] gap-1" style={{ gridTemplateColumns: '112px minmax(620px, 1fr)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Track</div>
          <div className="relative h-5 border-b border-[var(--space-border-default)]">{Array.from({ length: 7 }).map((_, index) => <span key={index} className="absolute -translate-x-1/2 text-[9px] text-[var(--space-text-muted)]" style={{ left: `${index * 100 / 6}%` }}>{Math.round(duration * index / 6)}s</span>)}</div>
          {[
            { id: 'avatar', label: 'Avatar / video', match: (_scene: Scene) => false, base: true },
            { id: 'broll', label: 'AI B-roll', match: (scene: Scene) => ['ai_video', 'image'].includes(visualKindOf(scene.visual_kind)) },
            { id: 'motion', label: 'Motion graphics', match: (scene: Scene) => visualKindOf(scene.visual_kind) === 'motion_graphic' },
            { id: 'text', label: 'Text overlays', match: (scene: Scene) => ['text_overlay', 'text_graphics'].includes(visualKindOf(scene.visual_kind)) },
          ].map((track) => <div key={track.id} className="contents">
            <div className="flex h-10 items-center text-[11px] font-medium text-[var(--space-text-secondary)]">{track.label}</div>
            <div className="relative h-10 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--space-text-primary)_4%,transparent)]">
              {track.base ? <div className="absolute inset-y-2 left-0 right-0 rounded-md" style={{ background: KIND_COLORS.heygen, opacity: 0.38 }} title="HeyGen presenter and uninterrupted master narration" /> : scenes.filter(track.match).map((scene) => { const kind = visualKindOf(scene.visual_kind); return <div key={scene.id} title={`Drag Scene ${scene.scene_index} to retime · ${scene.description}`} onPointerDown={(event) => beginRetime(event, scene, 'move')} className="absolute inset-y-1 cursor-grab rounded-md border border-white/20 shadow-sm active:cursor-grabbing" style={{ left: `${Math.max(0, Number(scene.script_start_sec) / duration * 100)}%`, width: `${Math.max(1.2, (Number(scene.script_end_sec) - Number(scene.script_start_sec)) / duration * 100)}%`, background: KIND_COLORS[kind], opacity: scene.status === 'skipped' ? 0.25 : 1 }}><button type="button" aria-label="Drag scene start" onPointerDown={(event) => beginRetime(event, scene, 'start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/15" /><span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-2 text-[9px] font-bold text-white">{scene.scene_index}</span><button type="button" aria-label="Drag scene end" onPointerDown={(event) => beginRetime(event, scene, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/15" /></div>; })}
            </div>
          </div>)}
          {mixedMusicUrl ? <><div className="flex h-9 items-center text-[11px] font-medium text-[var(--space-text-secondary)]">Music mix</div><div className="relative h-9 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--space-text-primary)_4%,transparent)]"><div className="absolute inset-y-2 left-0 right-0 rounded-md bg-[var(--space-semantic-success)] opacity-55" title="Mixed music bed with automatic narration ducking" /></div></> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--space-text-muted)]">
        {(['heygen', 'ai_video', 'motion_graphic', 'image', 'text_overlay'] as const).map((kind) => <span key={kind} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLORS[kind] }} />{kind === 'heygen' ? 'HeyGen talking head' : KIND_LABELS[kind]}</span>)}
        <span className="ml-auto">First 5 seconds and the CTA always stay on the presenter</span>
      </div>
      <div className="mt-4 flex gap-2">{(['low', 'medium', 'high'] as const).map((value) => <button key={value} onClick={() => onShare(value)} className={share === value ? 'rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-2 text-sm font-medium capitalize text-white shadow-[0_2px_8px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all' : 'rounded-lg bg-[var(--space-surface-card)] px-3 py-2 text-sm capitalize text-[var(--space-text-secondary)] transition-all hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,var(--space-surface-card))] hover:text-[var(--space-text-primary)]'}>{value} · {value === 'low' ? '30%' : value === 'medium' ? '50%' : '65%'}</button>)}</div>
    </div>
    <div className="mt-5 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div><p className="font-semibold text-[var(--space-text-primary)]">Scene image model</p><p className="mt-1 text-sm text-[var(--space-text-secondary)]">Choose the picture maker for Image scenes and stills. Assets already generated are reused, never re-billed.</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{IMAGE_MODELS.map((model) => <button key={model.id} type="button" onClick={() => onImageModel(model.id)} className={imageModel === model.id ? 'rounded-xl border border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent)] p-4 text-left ring-1 ring-[color-mix(in_srgb,var(--space-brand-primary-500)_25%,transparent)] transition-all' : 'rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--space-border-strong)]'}><span className="block font-semibold text-[var(--space-text-primary)]">{model.label}</span><span className="mt-1 block text-xs text-[var(--space-text-muted)]">{model.detail}</span></button>)}</div>
    </div>
    <div className="mt-5 space-y-3">{scenes.map((scene) => {
      const kind = visualKindOf(scene.visual_kind);
      const overlay = overlayOf(scene);
      const effect = normalizeEffect(overlay.effect);
      const effectMeta = effectPresetMeta(effect.preset);
      const busyHere = generatingSceneId === scene.id;
      const hasVideo = isVideoUrl(scene.render_url);
      const isMotionKind = kind === 'motion_graphic' || kind === 'text_overlay';
      const freshMotion = isMotionKind && hasFreshMotionClip(scene);
      const overAvatarOn = kind === 'text_overlay' && overlay.overAvatar === true;
      const spec = isMotionKind ? specOf(scene) : null;
      const stillUrl = !hasVideo ? ((overlay.showAsset !== false && overlay.assetUrl) || scene.render_url) : '';
      return <div key={scene.id} id={`sceneforge-scene-${scene.scene_index}`} className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 transition-colors hover:border-[var(--space-border-strong)]">
        <div className="flex flex-wrap items-center gap-3">
          <strong className="text-[var(--space-text-primary)]">Scene {scene.scene_index}</strong>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLORS[kind] }} />
          <input type="number" step={0.1} value={scene.script_start_sec} onChange={(e) => onPatch(scene.id, { script_start_sec: Number(e.target.value) })} className="input w-24" />
          <span className="text-[var(--space-text-muted)]">to</span>
          <input type="number" step={0.1} value={scene.script_end_sec} onChange={(e) => onPatch(scene.id, { script_end_sec: Number(e.target.value) })} className="input w-24" />
          <input value={scene.scene_type} onChange={(e) => onPatch(scene.id, { scene_type: e.target.value })} className="input w-36" />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" disabled={timelineBusy === scene.id} onClick={() => void splitScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2 py-1.5 text-xs text-[var(--space-text-secondary)]"><Scissors className="h-3.5 w-3.5" />Split</button>
            <button type="button" disabled={timelineBusy === scene.id} onClick={() => void duplicateScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2 py-1.5 text-xs text-[var(--space-text-secondary)]"><Copy className="h-3.5 w-3.5" />Duplicate</button>
            <label className="flex items-center gap-2 text-sm text-[var(--space-text-secondary)]"><input type="checkbox" checked={scene.approved} onChange={(e) => onPatch(scene.id, { approved: e.target.checked })} /> Approved</label>
          </div>
        </div>
        {/* SCENE TYPE — switching regenerates only THIS scene; everything else keeps its media. */}
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`Scene ${scene.scene_index} type`}>
          {KIND_CHOICES.map((choice) => { const active = kind === choice.id; return <button key={choice.id} type="button" role="radio" aria-checked={active} title={choice.hint} onClick={() => onKind(scene, choice.id)} className={active ? 'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold text-[var(--space-text-primary)]' : 'flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-sm text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)]'} style={active ? { borderColor: KIND_COLORS[choice.id], background: `color-mix(in srgb, ${KIND_COLORS[choice.id]} 14%, transparent)` } : undefined}><choice.icon className="h-4 w-4" style={active ? { color: KIND_COLORS[choice.id] } : undefined} />{KIND_LABELS[choice.id]}</button>; })}
          {kind === 'text_graphics' ? <span className="self-center rounded-full bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)] px-2.5 py-1 text-[11px] text-[var(--space-text-muted)]">Legacy text/graphics scene — pick a type above to upgrade it</span> : null}
        </div>
        <textarea value={scene.description} onChange={(e) => onPatch(scene.id, { description: e.target.value })} rows={2} className="mt-3 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-sm leading-relaxed text-[var(--space-text-primary)] outline-none transition-colors focus:border-[var(--space-brand-primary-500)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--space-brand-primary-500)_22%,transparent)]" />

        {kind === 'ai_video' ? <div className="mt-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">AI video prompt</label>
          <textarea value={scene.video_prompt && !scene.video_prompt.startsWith('mg:') ? scene.video_prompt : ''} onChange={(e) => onPatch(scene.id, { video_prompt: e.target.value })} rows={2} placeholder="Subject, motion, camera move, lighting — no on-screen text (use a Motion Graphic for text)" className="mt-1 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3 text-sm text-[var(--space-text-primary)] outline-none placeholder:text-[var(--space-text-muted)] focus:border-[var(--space-brand-primary-500)]" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button disabled={Boolean(generatingSceneId)} onClick={() => onGenerateVideo(scene)} className="flex items-center gap-1.5 rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-[var(--space-brand-primary-700)] disabled:opacity-40">{busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}{hasVideo ? 'Regenerate video' : 'Generate video'}</button>
            <span className="text-xs text-[var(--space-text-muted)]">{busyHere ? 'Generating the clip…' : hasVideo ? 'Clip ready — an unchanged prompt reuses it for free' : 'Or leave it: the batch run generates it with everything else, in parallel'}</span>
          </div>
          {/* COMPOSITED ELEMENT: a non-full layout crops/masks/scales the clip inside the scene with the caption beside it, instead of a full-screen takeover. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={overlay.mediaLayout || 'full'} onChange={(e) => patchOverlay(scene, { mediaLayout: e.target.value as MediaLayout })} className={inputClass} aria-label="Clip layout">{MEDIA_LAYOUTS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            <span className="text-[11px] text-[var(--space-text-muted)]">{MEDIA_LAYOUTS.find((m) => m.id === (overlay.mediaLayout || 'full'))?.detail}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--space-surface-card)] p-2">
            <button type="button" onClick={() => onPatch(scene.id, { audio_muted: scene.audio_muted === false })} className="flex items-center gap-1.5 text-xs font-medium text-[var(--space-text-secondary)]">{scene.audio_muted === false ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}{scene.audio_muted === false ? 'Native sound on' : 'Native sound muted'}</button>
            <label className="flex items-center gap-2 text-xs text-[var(--space-text-muted)]">Volume<input type="range" min={0} max={1} step={0.05} disabled={scene.audio_muted !== false} value={Number(scene.audio_volume || 0)} onChange={(event) => onPatch(scene.id, { audio_volume: Number(event.target.value) })} /></label>
            <span className="text-[10px] text-[var(--space-text-muted)]">HeyGen narration always remains the master.</span>
          </div>
          {hasVideo ? <video src={scene.render_url} controls muted={scene.audio_muted !== false} className="mt-3 max-h-56 w-full rounded-xl border border-[var(--space-border-default)] bg-black object-contain" /> : null}
        </div> : null}

        {isMotionKind ? <div className="mt-3 rounded-xl border bg-[var(--space-surface-panel)] p-3" style={{ borderColor: `color-mix(in srgb, ${KIND_COLORS[kind]} 45%, transparent)` }}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">{kind === 'motion_graphic' ? 'Motion graphic spec — every string renders exactly as written' : 'Text overlay — exact animated text'}</label>
            <span className="ml-auto text-[11px] text-[var(--space-text-muted)]">{sceneMotionDuration(scene).toFixed(1)}s clip · {aspect}</span>
          </div>
          {kind === 'motion_graphic' && spec ? <>
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={spec.kind} onChange={(e) => patchSpec(scene, { kind: e.target.value as MotionSpec['kind'] })} className={inputClass} aria-label="Layout kind">{MOTION_KINDS.map((meta) => <option key={meta.id} value={meta.id}>{meta.label}</option>)}</select>
              <span className="self-center text-[11px] text-[var(--space-text-muted)]">{MOTION_KINDS.find((meta) => meta.id === spec.kind)?.detail}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={spec.title || ''} onChange={(e) => patchSpec(scene, { title: e.target.value })} placeholder="Title (exact on-screen text)" className={inputClass} />
              <input value={spec.subtitle || ''} onChange={(e) => patchSpec(scene, { subtitle: e.target.value })} placeholder="Subtitle (optional)" className={inputClass} />
            </div>
            {spec.kind === 'branching_diagram' || spec.kind === 'node_graph' ? <input value={spec.root || ''} onChange={(e) => patchSpec(scene, { root: e.target.value })} placeholder={spec.kind === 'branching_diagram' ? 'Root node (e.g. OCEAN)' : 'Hub node (optional)'} className={`mt-2 w-full ${inputClass}`} /> : null}
            {spec.kind === 'big_stat' ? <div className="mt-2 flex flex-wrap gap-2">
              <input type="number" value={spec.stat?.value ?? ''} onChange={(e) => patchSpec(scene, { stat: { ...(spec.stat || { value: 0 }), value: Number(e.target.value) } })} placeholder="Number" className={`w-32 ${inputClass}`} />
              <input value={spec.stat?.prefix || ''} onChange={(e) => patchSpec(scene, { stat: { ...(spec.stat || { value: 0 }), prefix: e.target.value } })} placeholder="Prefix ($)" className={`w-24 ${inputClass}`} />
              <input value={spec.stat?.suffix || ''} onChange={(e) => patchSpec(scene, { stat: { ...(spec.stat || { value: 0 }), suffix: e.target.value } })} placeholder="Suffix (%)" className={`w-24 ${inputClass}`} />
              <input value={spec.stat?.label || ''} onChange={(e) => patchSpec(scene, { stat: { ...(spec.stat || { value: 0 }), label: e.target.value } })} placeholder="What the number is" className={`min-w-48 flex-1 ${inputClass}`} />
            </div> : null}
            {spec.kind === 'comparison' ? <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><input value={spec.leftTitle || ''} onChange={(e) => patchSpec(scene, { leftTitle: e.target.value })} placeholder="Left column title" className={`w-full ${inputClass}`} /><textarea key={`${scene.id}-left`} defaultValue={(spec.leftItems || []).join('\n')} onChange={(e) => patchSpec(scene, { leftItems: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6) })} rows={3} placeholder="One entry per line" className={`mt-2 w-full ${inputClass}`} /></div>
              <div><input value={spec.rightTitle || ''} onChange={(e) => patchSpec(scene, { rightTitle: e.target.value })} placeholder="Right column title" className={`w-full ${inputClass}`} /><textarea key={`${scene.id}-right`} defaultValue={(spec.rightItems || []).join('\n')} onChange={(e) => patchSpec(scene, { rightItems: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6) })} rows={3} placeholder="One entry per line" className={`mt-2 w-full ${inputClass}`} /></div>
            </div> : null}
            {spec.kind !== 'big_stat' && spec.kind !== 'comparison' && spec.kind !== 'text_reveal' ? <textarea key={`${scene.id}-items-${spec.kind}`} defaultValue={itemsToText(spec.items)} onChange={(e) => patchSpec(scene, { items: parseItemsText(e.target.value) })} rows={3} placeholder={spec.kind === 'bar_chart' ? 'One bar per line: Label | value — e.g. 2019 | 42' : 'One item per line: Label | sublabel (optional)'} className={`mt-2 w-full ${inputClass}`} /> : null}
          </> : null}
          {kind === 'text_overlay' ? <>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={overlay.text || ''} onChange={(e) => patchOverlay(scene, { text: e.target.value })} placeholder="Headline (exact text, always crisp)" className={inputClass} />
              <input value={overlay.subtext || ''} onChange={(e) => patchOverlay(scene, { subtext: e.target.value })} placeholder="Supporting line (optional)" className={inputClass} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--space-text-secondary)]"><input type="checkbox" checked={overAvatarOn} onChange={(e) => patchOverlay(scene, { overAvatar: e.target.checked })} />Show on the presenter — HeyGen stays visible, the label rides in a safe zone (never over the face)</label>
              {overAvatarOn ? <select value={AVATAR_SAFE_POSITIONS.includes((overlay.position || 'lower_third') as any) ? overlay.position || 'lower_third' : 'lower_third'} onChange={(e) => patchOverlay(scene, { position: e.target.value as OverlayConfig['position'] })} className={inputClass} aria-label="Safe-zone position">{OVERLAY_POSITIONS.filter((p) => AVATAR_SAFE_POSITIONS.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select> : null}
            </div>
          </> : null}
          {overAvatarOn ? <p className="mt-3 text-xs text-[var(--space-text-muted)]">Composed directly at final assembly — the presenter stays on screen and this callout sits beside them. No capture needed; the scene is already settled.</p> : <>
          <CompositionControls comp={compositionOf(scene)} onChange={(changes) => patchComposition(scene, changes)} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { setPreviewOnVideo(false); setPreviewSceneId(scene.id); }} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-semibold text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)]"><Eye className="h-3.5 w-3.5" />Preview animation</button>
            {avatarUrl ? <button type="button" onClick={() => { setPreviewOnVideo(true); setPreviewSceneId(scene.id); }} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-semibold text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)]"><Clapperboard className="h-3.5 w-3.5" />Preview on video</button> : null}
            <button type="button" disabled={Boolean(generatingSceneId)} onClick={() => onGenerateMotion(scene)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-all disabled:opacity-40" style={{ background: KIND_COLORS[kind] }}>{busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}{freshMotion ? 'Re-capture clip' : 'Capture clip'}</button>
            <span className="text-xs text-[var(--space-text-muted)]">{busyHere ? 'Recording the animation in this browser…' : freshMotion ? 'Clip captured — an unchanged spec reuses it' : 'Not captured yet — the batch run records it, or capture now'}</span>
          </div>
          {hasVideo && freshMotion ? <video src={scene.render_url} controls muted className="mt-3 max-h-56 w-full rounded-xl border border-[var(--space-border-default)] bg-black object-contain" /> : null}</>}
        </div> : null}

        {kind === 'image' || kind === 'text_graphics' ? <div className="mt-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Visual asset</label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {kind === 'text_graphics' ? <label className="flex items-center gap-2 text-xs text-[var(--space-text-secondary)]"><input type="checkbox" checked={overlay.showAsset !== false} onChange={(e) => patchOverlay(scene, { showAsset: e.target.checked })} />Show an image behind the text</label> : null}
            {kind === 'image' || overlay.showAsset !== false ? <>
              <label className="cursor-pointer text-xs text-[var(--space-text-brand)]"><Upload className="mr-1 inline h-3.5 w-3.5" />Use my image<input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(scene, file); e.currentTarget.value = ''; }} /></label>
              <button disabled={Boolean(generatingSceneId) || !scene.description.trim()} onClick={() => onGenerateImage(scene)} className="text-xs text-[var(--space-text-brand)] disabled:opacity-50">{busyHere ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <Image className="mr-1 inline h-3.5 w-3.5" />}Generate still</button>
            </> : null}
          </div>
          {(kind === 'image' || overlay.showAsset !== false) && pickableAssets.length ? <div className="mt-3">
            <p className="text-[11px] text-[var(--space-text-muted)]">Or reuse an existing asset — nothing is regenerated:</p>
            <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">{pickableAssets.map((asset) => <button key={asset.id} type="button" title={asset.prompt || asset.element_name} onClick={() => patchOverlay(scene, { assetUrl: asset.public_url })} className={overlay.assetUrl === asset.public_url ? 'h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-[var(--space-brand-primary-500)]' : 'h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--space-border-default)] opacity-80 transition hover:opacity-100'}><img src={asset.public_url} alt={asset.element_name} className="h-full w-full object-cover" /></button>)}</div>
          </div> : null}
          {kind === 'image' ? <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={overlay.mediaLayout || 'full'} onChange={(e) => patchOverlay(scene, { mediaLayout: e.target.value as MediaLayout })} className={inputClass} aria-label="Still layout">{MEDIA_LAYOUTS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            <span className="text-[11px] text-[var(--space-text-muted)]">How the still sits in the frame at assembly</span>
          </div> : null}
          {kind === 'image' ? <CompositionControls comp={compositionOf(scene)} onChange={(changes) => patchComposition(scene, changes)} /> : null}
          {stillUrl ? <img src={stillUrl} alt={`Scene ${scene.scene_index} visual`} className="mt-3 max-h-56 w-full rounded-xl border border-[var(--space-border-default)] bg-black object-contain" /> : null}
        </div> : null}

        {/* Overlay text + preset effect — for AI Video (an optional caption on the clip) and legacy text/graphics scenes. Motion kinds bake their text inside the captured clip. */}
        {kind === 'ai_video' || kind === 'text_graphics' ? <div className="mt-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Text overlay {kind === 'ai_video' ? '(optional, sits on the clip — prefer a Motion Graphic scene for important text)' : ''}</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input value={overlay.text || ''} onChange={(e) => patchOverlay(scene, { text: e.target.value })} placeholder="Headline (exact text, always crisp)" className={inputClass} />
            <input value={overlay.subtext || ''} onChange={(e) => patchOverlay(scene, { subtext: e.target.value })} placeholder="Supporting line (optional)" className={inputClass} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <select value={overlay.position || 'lower_third'} onChange={(e) => patchOverlay(scene, { position: e.target.value as OverlayConfig['position'] })} className={inputClass} aria-label="Text position">{OVERLAY_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            <select value={overlay.size || 'md'} onChange={(e) => patchOverlay(scene, { size: e.target.value as OverlayConfig['size'] })} className={inputClass} aria-label="Text size">{OVERLAY_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            <select value={overlay.animation || 'text_reveal'} onChange={(e) => patchOverlay(scene, { animation: e.target.value as OverlayConfig['animation'] })} className={inputClass} aria-label="Text animation">{TEXT_ANIMATIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            <select value={effect.preset} onChange={(e) => patchEffect(scene, { preset: e.target.value })} className={inputClass} aria-label="Effect preset">{EFFECT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            {effectMeta.directional ? <select value={effect.direction || effectMeta.defaultDirection} onChange={(e) => patchEffect(scene, { direction: e.target.value as EffectSetting['direction'] })} className={inputClass} aria-label="Effect direction"><option value="left">Left</option><option value="right">Right</option><option value="up">Up</option><option value="down">Down</option></select> : null}
            {effect.preset !== 'none' ? <label className="flex items-center gap-2 text-xs text-[var(--space-text-secondary)]">Intensity<input type="range" min={0.25} max={2} step={0.25} value={effect.intensity} onChange={(e) => patchEffect(scene, { intensity: Number(e.target.value) })} /></label> : null}
            {effect.preset !== 'none' ? <select value={effect.easing || effectMeta.defaultEasing} onChange={(e) => patchEffect(scene, { easing: e.target.value as EffectSetting['easing'] })} className={inputClass} aria-label="Effect easing"><option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Ease in-out</option></select> : null}
          </div>
          {(overlay.text || overlay.subtext || stillUrl) ? <div className="relative mt-3 flex aspect-video max-h-56 w-full items-end justify-center overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[#0A0F1E]">
            {stillUrl ? <img src={stillUrl} alt={`Scene ${scene.scene_index} visual`} className="absolute inset-0 h-full w-full object-cover" style={{ animation: PREVIEW_ANIMS[effect.preset] || undefined }} /> : null}
            {effect.preset === 'light_sweep' ? <span aria-hidden className="pointer-events-none absolute bottom-[-25%] left-[35%] top-[-25%] w-[30%]" style={{ animation: 'sfSweep 3s ease-in-out infinite', background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0) 100%)' }} /> : null}
            {hasVideo && kind === 'ai_video' ? <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">AI clip attached</span> : null}
            <div className={overlay.position === 'top' ? 'absolute inset-x-0 top-[7%] px-6 text-center' : overlay.position === 'center' ? 'absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center' : 'absolute inset-x-0 bottom-[10%] px-6 text-center'}>
              {overlay.text ? <div className="text-lg font-extrabold leading-tight text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.8)]">{overlay.text}</div> : null}
              {overlay.subtext ? <div className="mt-1 text-xs font-medium text-white/90 [text-shadow:0_2px_10px_rgba(0,0,0,0.7)]">{overlay.subtext}</div> : null}
            </div>
          </div> : null}
        </div> : null}

        {scene.qc_weak && scene.qc_suggestion ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-warning-500)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-warning-500)_10%,transparent)] p-3"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-[var(--space-text-primary)]">Opus QC · weak element</p><p className="mt-1 text-sm text-[var(--space-text-secondary)]">{scene.qc_suggestion}</p></div><button type="button" disabled={Boolean(generatingSceneId)} onClick={() => retryWeakScene(scene)} className="rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Regenerate only Scene {scene.scene_index}</button></div> : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--space-text-muted)]">{scene.status === 'error' ? 'last generation failed — retry it or switch the scene type' : scene.status === 'skipped' ? 'skipped — excluded from the film' : isMotionKind ? (overAvatarOn ? 'presenter callout — composed at final assembly, nothing to capture' : freshMotion ? 'motion clip ready' : 'animation defined — clip captures on generate') : hasVideo ? 'AI clip ready' : stillUrl ? 'visual ready' : kind === 'text_graphics' ? 'text overlay ready — no render needed' : kind === 'image' ? 'still not generated yet' : 'clip not generated yet'}</span>
          <button onClick={() => onRemove(scene.id)} className="ml-auto text-sm text-[var(--space-semantic-danger)]"><Trash2 className="mr-1 inline h-4 w-4" />Remove</button>
        </div>
      </div>;
    })}</div>
    <div className="mt-5 flex flex-wrap gap-3"><button onClick={onAdd} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-4 py-3 font-medium text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]"><Plus className="h-4 w-4" />Add time range</button><button disabled={!scenes.length || approved !== scenes.length} onClick={onGenerate} className="rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-3 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0">Generate all scenes</button></div>

    {previewScene ? (() => {
      const previewComp = compositionOf(previewScene);
      const previewSpec = sceneMotionSpec(previewScene);
      const previewDuration = sceneMotionDuration(previewScene);
      // The Motion Director's timeline (when current) drives the preview too,
      // so what plays here is exactly what the capture will record.
      const previewDirected = sceneDirection(previewScene);
      const onVideo = previewOnVideo && Boolean(avatarUrl);
      const portraitPreview = aspect === '9:16';
      const rect = portraitPreview ? portraitPlacement(previewComp, { tall: true }) : null;
      const compact = previewSpec.kind === 'big_stat' || previewSpec.kind === 'text_reveal';
      const unitScale = previewComp.mode === 'central' ? 1.12 : compact ? 1.5 : 1.25;
      return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-label={`Scene ${previewScene.scene_index} motion preview`} onClick={() => setPreviewSceneId(null)}>
      <div className="relative w-full max-w-3xl rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-[var(--space-text-primary)]">Scene {previewScene.scene_index} · live motion preview</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPreviewOnVideo(false)} className={!onVideo ? 'rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-1.5 text-xs font-semibold text-white' : 'rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs text-[var(--space-text-secondary)]'}>Preview graphic</button>
            <button type="button" disabled={!avatarUrl} title={avatarUrl ? '' : 'Render the avatar master first'} onClick={() => setPreviewOnVideo(true)} className={onVideo ? 'rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-1.5 text-xs font-semibold text-white' : 'rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs text-[var(--space-text-secondary)] disabled:opacity-40'}>Preview on video</button>
            <button aria-label="Close preview" onClick={() => setPreviewSceneId(null)} className="rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)]"><X className="h-5 w-5 text-[var(--space-text-primary)]" /></button>
          </div>
        </div>
        {onVideo
          ? <div className="relative mx-auto overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black" style={portraitPreview ? { aspectRatio: '9 / 16', height: '68vh' } : { aspectRatio: '16 / 9', width: '100%' }}>
            <video src={avatarUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
            {previewComp.mode === 'fullscreen'
              ? <div className="absolute inset-0"><MotionGraphicPlayer spec={previewSpec} directed={previewDirected} aspect={aspect} durationSec={previewDuration} tileWidth={portraitPreview ? 1080 : 1920} tileHeight={portraitPreview ? 1920 : 1080} className="h-full w-full" /></div>
              : portraitPreview && rect
                ? <div style={previewRectStyle(previewComp)}><MotionGraphicPlayer spec={previewSpec} directed={previewDirected} aspect={aspect} durationSec={previewDuration} transparent tileWidth={rect.w} tileHeight={rect.h} unitScale={unitScale} className="h-full w-full" /></div>
                : <div className="overflow-hidden rounded-2xl border-2 border-white/20 shadow-2xl" style={previewRectStyle(previewComp)}><MotionGraphicPlayer spec={previewSpec} directed={previewDirected} aspect="16:9" durationSec={previewDuration} tileWidth={1920} tileHeight={1080} className="h-full w-full" /></div>}
          </div>
          : <MotionGraphicPlayer spec={previewSpec} directed={previewDirected} aspect={aspect} durationSec={previewDuration} className="mx-auto max-h-[70vh] w-full overflow-hidden rounded-xl border border-[var(--space-border-default)]" />}
        <p className="mt-2 text-xs text-[var(--space-text-muted)]">{onVideo ? 'This is the real composition: your actual avatar footage with the graphic at its final position and size — what you see here is what assembly ships.' : 'The isolated animation. Use “Preview on video” to judge it against the real presenter footage.'}</p>
      </div>
    </div>; })() : null}
  </div>;
}
