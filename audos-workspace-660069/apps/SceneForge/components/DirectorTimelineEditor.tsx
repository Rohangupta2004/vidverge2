import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, GripVertical, Save } from 'lucide-react';
import type { Project, Scene } from '../lib/supabase';
import { fallbackDirection } from '../agents/motionDirector';
import { sceneMotionDuration, sceneMotionSpec } from '../lib/motionCapture';
import { saveSceneDirectorTimeline } from '../lib/directorStore';
import { normalizeSceneDirection, type DirectedLayer, type EntranceStyle, type SceneDirection, type ZoneId } from '../lib/visualTimeline';

const ZONES: ZoneId[] = ['top', 'upper', 'center', 'lower', 'bottom_safe', 'left', 'right', 'full'];
const ENTRANCES: EntranceStyle[] = ['spring', 'rise', 'mask', 'draw', 'pop', 'slide_fade', 'blur_in', 'countup'];
const EXITS: Array<'settle' | 'collapse' | 'drift'> = ['settle', 'collapse', 'drift'];
const CAMERAS: SceneDirection['camera']['move'][] = ['push_in', 'pull_back', 'drift_left', 'drift_right', 'none'];

function directionFor(project: Project, scene: Scene): SceneDirection {
  return normalizeSceneDirection(scene.director_timeline)
    || fallbackDirection(sceneMotionSpec(scene), sceneMotionDuration(scene), project.aspect_ratio === '9:16' ? '9:16' : '16:9');
}

export default function DirectorTimelineEditor({ project, scenes, onSaved, onBack, onOpenFinishingEditor }: {
  project: Project;
  scenes: Scene[];
  onSaved: (scene: Scene) => void;
  onBack: () => void;
  onOpenFinishingEditor: () => void;
}) {
  const directedScenes = useMemo(() => scenes.filter((scene) => scene.status !== 'skipped'), [scenes]);
  const [sceneId, setSceneId] = useState(directedScenes[0]?.id || '');
  const selected = directedScenes.find((scene) => scene.id === sceneId) || directedScenes[0] || null;
  const [draft, setDraft] = useState<SceneDirection | null>(selected ? directionFor(project, selected) : null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!selected) { setDraft(null); return; }
    setSceneId(selected.id);
    setDraft(directionFor(project, selected));
    setNote('');
  }, [selected?.id, project.aspect_ratio]);

  const updateLayer = (index: number, patch: Partial<DirectedLayer>) => setDraft((current) => current ? {
    ...current,
    layers: current.layers.map((layer, i) => i === index ? { ...layer, ...patch } : layer),
  } : current);

  const moveLayer = (from: number, to: number) => {
    if (from === to) return;
    setDraft((current) => {
      if (!current) return current;
      const layers = [...current.layers];
      const [moved] = layers.splice(from, 1);
      layers.splice(to, 0, moved);
      return { ...current, layers: layers.map((layer, index) => ({ ...layer, zIndex: index + 1 })) };
    });
  };

  const save = async () => {
    if (!selected || !draft || saving) return;
    setSaving(true); setNote('Saving timeline through SceneForge…');
    try {
      const saved = await saveSceneDirectorTimeline(selected, draft);
      onSaved(saved || ({ ...selected, director_timeline: draft as unknown as Record<string, unknown> } as Scene));
      setNote('Timeline saved. Source footage and images are untouched; the next generation pass refreshes only this scene’s motion layers before export.');
    } catch (error: any) {
      setNote(`Could not save the timeline: ${String(error?.message || error)}`);
    } finally { setSaving(false); }
  };

  if (!selected || !draft) return <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--space-text-muted)]">No directed scenes are available.</div>;

  return <div className="flex h-full min-h-0 flex-col bg-[var(--space-surface-bg)] text-[var(--space-text-primary)]">
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-5 py-3">
      <button onClick={onBack} className="flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-sm"><ArrowLeft className="h-4 w-4" />Studio</button>
      <div className="min-w-0 flex-1"><h1 className="font-bold">Director timeline</h1><p className="text-xs text-[var(--space-text-muted)]">Per-layer timing and placement · non-destructive</p></div>
      <button onClick={onOpenFinishingEditor} className="flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-sm"><ExternalLink className="h-4 w-4" />Finishing editor</button>
      <button disabled={saving} onClick={() => void save()} className="flex items-center gap-2 rounded-lg bg-[var(--space-brand-primary-600)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save timeline'}</button>
    </header>

    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="overflow-y-auto border-r border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
        <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--space-text-muted)]">Scenes</p>
        {directedScenes.map((scene) => <button key={scene.id} onClick={() => setSceneId(scene.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${scene.id === selected.id ? 'bg-[var(--space-brand-primary-600)] text-white' : 'hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)]'}`}>
          <span className="font-semibold">Scene {scene.scene_index}</span><span className="ml-2 opacity-70">{scene.visual_kind?.replace(/_/g, ' ')}</span>
        </button>)}
      </aside>

      <main className="min-h-0 overflow-y-auto p-4 sm:p-6">
        <section className="mb-4 grid gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 sm:grid-cols-3">
          <label className="text-xs font-semibold text-[var(--space-text-secondary)]">Camera move<select value={draft.camera.move} onChange={(event) => setDraft({ ...draft, camera: { ...draft.camera, move: event.target.value as SceneDirection['camera']['move'] } })} className="mt-1 w-full rounded-lg bg-[var(--space-surface-panel)] p-2 text-sm">{CAMERAS.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
          <label className="text-xs font-semibold text-[var(--space-text-secondary)]">Intensity<input type="number" min="0.1" max="1.5" step="0.05" value={draft.camera.intensity ?? 1} onChange={(event) => setDraft({ ...draft, camera: { ...draft.camera, intensity: Math.max(0.1, Math.min(1.5, Number(event.target.value) || 0.1)) } })} className="mt-1 w-full rounded-lg bg-[var(--space-surface-panel)] p-2 text-sm" /></label>
          <div className="text-xs text-[var(--space-text-muted)]"><span className="font-semibold text-[var(--space-text-secondary)]">Duration</span><div className="mt-2 font-mono text-sm">{draft.duration.toFixed(2)}s · {draft.layers.length} layers</div></div>
        </section>

        <div className="space-y-2">
          {draft.layers.map((layer, index) => <div key={layer.id} draggable onDragStart={() => setDragging(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging !== null) moveLayer(dragging, index); setDragging(null); }} className="grid gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3 shadow-sm md:grid-cols-[28px_minmax(130px,1.3fr)_repeat(6,minmax(88px,1fr))]">
            <div className="flex cursor-grab items-center text-[var(--space-text-muted)]"><GripVertical className="h-4 w-4" /></div>
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{layer.id}</div><div className="truncate text-xs text-[var(--space-text-muted)]">{layer.type} · z {layer.zIndex}</div></div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Zone<select value={layer.zone} onChange={(event) => updateLayer(index, { zone: event.target.value as ZoneId })} className="mt-1 w-full rounded-md bg-[var(--space-surface-panel)] p-2 text-xs normal-case">{ZONES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">In at<input type="number" min="0" max={draft.duration} step="0.05" value={layer.entrance.at} onChange={(event) => updateLayer(index, { entrance: { ...layer.entrance, at: Number(event.target.value) || 0 } })} className="mt-1 w-full rounded-md bg-[var(--space-surface-panel)] p-2 text-xs" /></label>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Entrance<select value={layer.entrance.style} onChange={(event) => updateLayer(index, { entrance: { ...layer.entrance, style: event.target.value as EntranceStyle } })} className="mt-1 w-full rounded-md bg-[var(--space-surface-panel)] p-2 text-xs normal-case">{ENTRANCES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Exit at<input type="number" min="0" max={draft.duration} step="0.05" value={layer.exit?.at ?? draft.duration} onChange={(event) => updateLayer(index, { exit: { ...(layer.exit || {}), at: Number(event.target.value) || draft.duration } })} className="mt-1 w-full rounded-md bg-[var(--space-surface-panel)] p-2 text-xs" /></label>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Exit<select value={layer.exit?.style || 'settle'} onChange={(event) => updateLayer(index, { exit: { ...(layer.exit || {}), style: event.target.value as 'settle' | 'collapse' | 'drift' } })} className="mt-1 w-full rounded-md bg-[var(--space-surface-panel)] p-2 text-xs normal-case">{EXITS.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Depth<input type="range" min="0" max="1" step="0.05" value={layer.depth_z ?? 0.5} onChange={(event) => updateLayer(index, { depth_z: Number(event.target.value) })} className="mt-3 w-full" /><span className="font-mono text-[10px]">{(layer.depth_z ?? 0.5).toFixed(2)}</span></label>
          </div>)}
        </div>
        {note ? <p className="mt-4 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-sm text-[var(--space-text-secondary)]">{note}</p> : null}
      </main>
    </div>
  </div>;
}
